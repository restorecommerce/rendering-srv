import * as pkg from 'cheerio';
// microservice
import { Events, registerProtoMeta, Topic } from '@restorecommerce/kafka-client';
import {
  type Logger
} from '@restorecommerce/logger';
import { Renderer } from '@restorecommerce/handlebars-helperized';
import {
  type ServiceConfig
} from '@restorecommerce/service-config';
import {
  CommandInterface,
  Server,
  OffsetStore,
  buildReflectionService,
  Health
} from '@restorecommerce/chassis-srv';
import fs from 'node:fs';
import { createClient, RedisClientType } from 'redis';
import {
  CommandInterfaceServiceDefinition,
  protoMetadata as commandInterfaceMeta
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/commandinterface.js';
import { BindConfig } from '@restorecommerce/chassis-srv/lib/microservice/transport/provider/grpc/index.js';
import { HealthDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/grpc/health/v1/health.js';
import {
  protoMetadata as reflectionMeta
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/grpc/reflection/v1alpha/reflection.js';
import { ServerReflectionService } from 'nice-grpc-server-reflection';
import {
  RenderRequestList,
  RenderResponse,
  RenderResponseList,
  RenderRequest_Strategy,
  protoMetadata as renderMeta,
  RenderResult_Bodies
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/rendering.js';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';
import { unmarshallProtobufAny } from './utils.js';

type Handler = (msg: any, context?: any, config?: any, eventName?: string) => Promise<any>

registerProtoMeta(commandInterfaceMeta, reflectionMeta, renderMeta);

const { load } = pkg;
// we store here the handlebars helpers
const CURR_DIR = process.cwd();
const REL_PATH_HANDLEBARS = '/handlebars/';
const HANDLEBARS_DIR = './handlebars';
const customHelpersList: string[] = [];

export class RenderingService {
  protected readonly listeners = new Map<string, Handler>();
  protected commandService: CommandInterface;
  protected offsetStore: OffsetStore;
  protected readonly techUser: Subject;
  
  constructor(
    protected readonly cfg: ServiceConfig,
    protected readonly logger: Logger,
    protected readonly events: Events = new Events(cfg.get('events:kafka'), logger),
    protected readonly server: Server = new Server(cfg.get('server'), logger),
    protected readonly topics: Record<string, Topic> = {},
  ) {
    this.techUser = this.cfg.get('techUser');
    this.listeners.set('renderRequest', (...args) => this.onRenderRequest(...args));
    this.listeners.set('healthCheckCommand', (...args) => this.onCommand(...args));
    this.listeners.set('versionCommand', (...args) => this.onCommand(...args));
  }

  private async fetchStyle(url: string): Promise<string> {
    if (url) {
      // if there is a tech user configured, pass the token
      // in the headers when requesting the css file
      // else try to do a request with empty headers
      const headers = this.techUser?.token ? {
        Authorization: `Bearer ${this.techUser.token}`
      } : undefined;
      const tplResponse = await fetch(url, { headers });
      if (!tplResponse.ok) {
        throw new Error('Could not retrieve CSS file from provided URL');
      } else {
        return await tplResponse.text();
      }
    }
    return undefined;
  }

  private async onRenderRequest(
    request: RenderRequestList,
    ...args: any
  ): Promise<void> {
    const response: RenderResponseList = {
      id: request.id,
      operation_status: {
        code: 200,
        message: 'SUCCESS',
      }
    };

    try {
      this.logger?.info('Rendering request received');
      if (!request?.items?.length) {
        throw {
          code: 400,
          message: 'Empty request!'
        };
      }

      response.items = await Promise.all(request.items.map(async (item): Promise<RenderResponse> => {
        try {
          const result: RenderResponse = {
            status: {
              id: item.id,
              code: 200,
              message: 'OK',
            }
          };
          const data = unmarshallProtobufAny(item?.data);
          // options are the handlebar-helperized options that can be
          // specified in the payload
          const options = item?.options?.value ? unmarshallProtobufAny(item.options) : {};
          const renderingStrategy = item.strategy ?? RenderRequest_Strategy.INLINE;
          if (!item.templates.length) {
            throw {
              // id: item.id,
              code: 400,
              message: 'Missing templates',
            };
          }

          if (!data || Object.keys(data).length === 0) {
            throw {
              // id: item.id,
              code: 400,
              message: 'Missing data',
            };
          }

          // Modify to handle style for each template -> style
          // Ignore fetch fail on style???
          const style = await this.fetchStyle(item?.style_url).catch(
            ({ message }: any) => {
              result.status.code = 500;
              result.status.message = message;
              return null;
            }
          );
          const bodies: RenderResult_Bodies[] = await Promise.all(item.templates.map(async template => {
            const body = template.body?.toString(template.charset as BufferEncoding);
            const layout = (template as any).layout?.toString(template.charset as BufferEncoding); // may be null
            const renderer = renderingStrategy === RenderRequest_Strategy.INLINE
              ? new Renderer(body, layout, style, options, customHelpersList)
              : new Renderer(body, layout, null, options, customHelpersList);
            let rendered = await renderer.render(data); // rendered HTML string
            if (renderingStrategy === RenderRequest_Strategy.COPY && style) {
              const html = load(rendered);
              html('html').append('<style></style>');
              html('style').attr('type', 'text/css');
              html('style').append(style);
              rendered = html.html();
            }

            return {
              id: template.id,
              body: Buffer.from(rendered),
              charset: 'utf8',
            };
          }));

          result.payload = {
            id: item.id,
            bodies,
          };
          return result;
        }
        catch ({ code, message, stack }: any) {
          this.logger?.error(
            `Error while rendering template: ${item.id}`,
            { code, message, stack }
          );
          return {
            status: {
              id: item.id,
              code: Number.isInteger(code) ? code : 500,
              message: message ?? 'Unknown Error!',
            }
          };
        }
      }));

      if (response.items.some(item => item.status?.code !== 200)) {
        response.operation_status = {
          code: 207,
          message: 'Patrial execution including errors!'
        };
      }
      
      await this.topics.rendering.emit(
        'renderResponse',
        response
      ).catch(
        ({ code, message, stack }: any) => this.logger?.error(
          `Fatal error while emitting render response: ${request.id}`,
          { code, message, stack }
        )
      );
    }
    catch ({ code, message, stack }: any) {
      this.logger?.error(
        `Error on render request: ${request.id}`,
        { code, message, stack }
      );

      response.operation_status = {
        code: Number.isInteger(code) ? code : 500,
        message: message ?? 'Unknown Error!',
      }

      await this.topics.rendering.emit(
        'renderResponse',
        response,
      ).catch(
        ({ code, message, stack }: any) => this.logger?.error(
          `Fatal error while emitting render response: ${request.id}`,
          { code, message, stack }
        )
      );
    }
  }

  private async onCommand(
    msg: any,
    context: any,
    ...args: any
  ): Promise<any> {
    await this.commandService.command(msg, context);
  }

  /*
   * start the server
   */
  async start(): Promise<any> {
    // read all file names from the handlebars folder
    let absolutePath: string;
    for (const file of fs.readdirSync(HANDLEBARS_DIR)) {
      if (file.endsWith('.cjs')) {
        absolutePath = CURR_DIR + REL_PATH_HANDLEBARS + file;
        customHelpersList.push(absolutePath);
      }
    }

    await this.subscribeTopics();
    // init redis client for subject index
    const redisConfig = this.cfg.get('redis');
    redisConfig.database = this.cfg.get('redis:db-indexes:db-subject');
    const redisClient: RedisClientType<any, any> = createClient(redisConfig);
    redisClient.on('error', (err) => this.logger?.error('Redis client error in subject store', err));
    await redisClient.connect();
    this.commandService = new CommandInterface(this.server, this.cfg, this.logger, this.events as any, redisClient);
    const serviceNamesCfg = this.cfg.get('serviceNames');
    await this.server.bind(serviceNamesCfg.cis, {
      service: CommandInterfaceServiceDefinition,
      implementation: this.commandService
    } as BindConfig<CommandInterfaceServiceDefinition>);

    // Add ReflectionService
    const reflectionServiceName = serviceNamesCfg.reflection;
    const reflectionService = buildReflectionService([
      { descriptor: commandInterfaceMeta.fileDescriptor }
    ]);
    await this.server.bind(reflectionServiceName, {
      service: ServerReflectionService,
      implementation: reflectionService
    });

    await this.server.bind(serviceNamesCfg.health, {
      service: HealthDefinition,
      implementation: new Health(this.commandService)
    } as BindConfig<HealthDefinition>);

    await this.server.start();
    this.logger?.info('Service started successfully');
  }

  /**
   * subscribes to list of topics based on event names in config and
   * upon receiving the request renders the response
   */
  async subscribeTopics(): Promise<any> {
    this.logger?.info('Subscribing Kafka topics');
    await this.events.start();
    this.offsetStore = new OffsetStore(this.events as any, this.cfg, this.logger);

    const kafkaCfg = this.cfg.get('events:kafka');
    const topicTypes = Object.keys(kafkaCfg.topics);
    for (const topicType of topicTypes) {
      const topicName = kafkaCfg.topics[topicType].topic;
      this.topics[topicType] = await this.events.topic(topicName);
      const offsetValue = await this.offsetStore.getOffset(topicName);
      this.logger?.info('subscribing to topic with offset value',
        topicName, offsetValue);
      if (kafkaCfg.topics[topicType].events) {
        const eventNames = kafkaCfg.topics[topicType].events;
        for (const eventName of eventNames) {
          await this.topics[topicType].on(
            eventName,
            this.listeners.get(eventName),
            { startingOffset: offsetValue }
          );
        }
      }
    }
  }

  async stop(): Promise<any> {
    await this.server.stop();
    await this.events.stop();
    await this.offsetStore.stop();
  }
}