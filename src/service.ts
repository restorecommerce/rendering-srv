'use strict';

import * as _ from 'lodash';
import * as cheerio from 'cheerio';
// microservice
import { Events, Topic } from '@restorecommerce/kafka-client';
import { createLogger } from '@restorecommerce/logger';
import Renderer from '@restorecommerce/handlebars-helperized';
import { createServiceConfig } from '@restorecommerce/service-config';
// gRPC / command-interface
import * as chassis from '@restorecommerce/chassis-srv';
import * as fs from 'fs';
import { createClient, RedisClientType } from 'redis';
import { Logger } from 'winston';

const RENDER_REQ_EVENT = 'renderRequest';
const HEALTH_CMD_EVENT = 'healthCheckCommand';
const HEALTH_RES_EVENT = 'healthCheckResponse';

// we store here the handlebars helpers
const CURR_DIR = process.cwd();
const REL_PATH_HANDLEBARS = '/handlebars/';
const HANDLEBARS_DIR = './handlebars';
let customHelpersList: string[] = [];

enum Strategy {
  INLINE = 1,
  COPY = 2
}

// node-fetch is now ESM only module
// prevent TypeScript rewrite of async import() to require() in CJS projects
const _importDynamic = new Function('modulePath', 'return import(modulePath)');
const fetch = async (...args) => {
  const { default: fetch } = await _importDynamic('node-fetch');
  return fetch(...args);
};

export class Service {
  logger: Logger;
  cfg: any;
  events: Events;
  topics: any;
  server: chassis.Server;
  commandService: chassis.CommandInterface;
  offsetStore: chassis.OffsetStore;
  constructor(cfg: any, logger: Logger) {
    this.cfg = cfg;
    this.logger = logger;

    this.events = new Events(this.cfg.get('events:kafka'), this.logger);
    this.topics = {};

    this.server = new chassis.Server(cfg.get('server'), logger);
  }

  /*
   * start the server
   */
  async start(): Promise<any> {
    // read all file names from the handlebars folder
    let absolutePath: string;
    fs.readdirSync(HANDLEBARS_DIR).forEach((file) => {
      absolutePath = CURR_DIR + REL_PATH_HANDLEBARS + file;
      customHelpersList.push(absolutePath);
    });

    await this.subscribeTopics();
    // init redis client for subject index
    const redisConfig = this.cfg.get('redis');
    redisConfig.database = this.cfg.get('redis:db-indexes:db-subject');
    const redisClient: RedisClientType<any, any> = createClient(redisConfig);
    redisClient.on('error', (err) => this.logger.error('Redis client error in subject store', err));
    await redisClient.connect();
    this.commandService = new chassis.CommandInterface(this.server, this.cfg, this.logger, this.events, redisClient);
    const serviceNamesCfg = this.cfg.get('serviceNames');
    await this.server.bind(serviceNamesCfg.cis, this.commandService);

    // Add ReflectionService
    const reflectionServiceName = serviceNamesCfg.reflection;
    const transportName = this.cfg.get(`server:services:${reflectionServiceName}:serverReflectionInfo:transport:0`);
    const transport = this.server.transport[transportName];
    const reflectionService = new chassis.ServerReflection(transport.$builder, this.server.config);
    await this.server.bind(reflectionServiceName, reflectionService);

    await this.server.bind(serviceNamesCfg.health, new chassis.Health(this.commandService));

    await this.server.start();
  }

  marshallProtobufAny(msg: any): any {
    return {
      type_url: 'rendering',
      value: Buffer.from(JSON.stringify(msg))
    };
  }

  unmarshallProtobufAny(msg: any): any {
    return JSON.parse(msg.value.toString());
  }

  private setAuthenticationHeaders(token) {
    return {
      Authorization: `Bearer ${token}`
    };
  }

  /**
   * subscribes to list of topics based on event names in config and
   * upon receiving the request renders the response
   */
  async subscribeTopics(): Promise<any> {
    this.logger.info('Subscribing Kafka topics');
    await this.events.start();
    this.offsetStore = new chassis.OffsetStore(this.events, this.cfg, this.logger);
    const that = this;
    const listener = async (msg: any, context: any, config: any, eventName: string): Promise<any> => {
      const response = [];
      if (eventName == RENDER_REQ_EVENT) {
        that.logger.info('Rendering request received');
        const request = msg;
        const id: string = request.id;
        if (!request || !request.payload || request.payload.length == 0) {
          const error = { error: 'Missing payload' };
          response.push(that.marshallProtobufAny(error));
        } else {

          const payloads = request.payload;

          for (let payload of payloads) {
            const templates = that.unmarshallProtobufAny(payload.templates);
            const data = that.unmarshallProtobufAny(payload.data);

            // options are the handlebar-helperized options that can be
            // specified in the payload
            let options: any;
            if (!!payload.options && !_.isEmpty(payload.options) && !_.isEmpty(payload.options.value)) {
              options = that.unmarshallProtobufAny(payload.options);
            } else {
              options = {};
            }

            const renderingStrategy = payload.strategy || Strategy.INLINE;
            if (!templates || _.keys(templates).length == 0) {
              const error = { error: 'Missing templates' };
              response.push(that.marshallProtobufAny(error));
            }

            if (!data || _.keys(data).length == 0) {
              const error = { error: 'Missing data' };
              response.push(that.marshallProtobufAny(error));
            }

            // Modify to handle style for each template -> style
            let style = payload.style_url;
            try {
              if (style) {
                // if there is a tech user configured, pass the token
                // in the headers when requesting the css file
                // else try to do a request with empty headers
                const techUsersCfg = this.cfg.get('techUsers');
                let headers;
                if (techUsersCfg && techUsersCfg.length > 0) {
                  const hbsUser = _.find(techUsersCfg, { id: 'hbs_user' });
                  headers = this.setAuthenticationHeaders(hbsUser.token);
                }
                const tplResponse = await fetch(style, { headers });
                if (!tplResponse.ok) {
                  that.logger.info('Could not retrieve CSS file from provided URL');
                } else {
                  style = await tplResponse.text();
                }
              }
            } catch (err) {
              that.logger.error('Error occurred while retrieving style sheet');
              response.push(that.marshallProtobufAny({ error: err.message }));
            }

            // read the input content type
            const contType = payload.content_type;
            if (!contType) {
              response.push(that.marshallProtobufAny({ error: 'Missing content-type' }));
            }

            const responseObj = {};
            for (let key in templates) {
              // key-value {'tplName': HBS tpl}, {'layout': HBS tpl}
              const template = templates[key];
              const body = template.body;
              const layout = template.layout; // may be null

              let tplRenderer;
              if (renderingStrategy == Strategy.INLINE) {
                tplRenderer = new Renderer(body, layout, style, options, customHelpersList);
              } else {
                // do not inline!
                tplRenderer = new Renderer(body, layout, null, options, customHelpersList);
              }
              let rendered;
              try {
                rendered = tplRenderer.render(data);  // rendered HTML string
              } catch (err) {
                this.logger.error('Error while rendering template:', template);
                this.logger.error('Error:', err);
                response.push(that.marshallProtobufAny({ error: 'Error while rendering template' }));
              }
              if (renderingStrategy == Strategy.COPY && style) {
                const html = cheerio.load(rendered);
                html('html').append('<style></style>');
                html('style').attr('type', 'text/css');
                html('style').append(style);
                rendered = html.html();
              }
              if (rendered) {
                responseObj[key] = rendered;
              }
              if (contType) {
                Object.assign(responseObj, { content_type: contType });
              }
            }
            if (!_.isEmpty(responseObj)) {
              response.push(that.marshallProtobufAny(responseObj));
            }
          }
        }
        await that.reply(id, response);
      } else {  // commands
        await that.commandService.command(msg, context);
      }
    };

    const kafkaCfg = this.cfg.get('events:kafka');
    const topicTypes = _.keys(kafkaCfg.topics);
    for (let topicType of topicTypes) {
      const topicName = kafkaCfg.topics[topicType].topic;
      this.topics[topicType] = await this.events.topic(topicName);
      const offsetValue = await this.offsetStore.getOffset(topicName);
      this.logger.info('subscribing to topic with offset value',
        topicName, offsetValue);
      if (kafkaCfg.topics[topicType].events) {
        const eventNames = kafkaCfg.topics[topicType].events;
        for (let eventName of eventNames) {
          await this.topics[topicType].on(eventName, listener,
            { startingOffset: offsetValue });
        }
      }
    }

  }

  async reply(requestID: string, response: Array<any>): Promise<any> {
    const message = {
      id: requestID,
      response
    };
    await this.topics.rendering.emit('renderResponse', message);
  }

  async stop(): Promise<any> {
    await this.server.stop();
    await this.events.stop();
    await this.offsetStore.stop();
  }
}


export class Worker {
  service: Service;
  constructor() { }
  /**
   * starting/stopping the actual server
   */
  async start(cfg?: any, logger?: Logger): Promise<any> {
    if (!cfg) {
      cfg = createServiceConfig(process.cwd());
      const loggerCfg = cfg.get('logger');
      loggerCfg.esTransformer = (msg) => {
        msg.fields = JSON.stringify(msg.fields);
        return msg;
      };
      logger = createLogger(loggerCfg);
    }

    this.service = new Service(cfg, logger);
    await this.service.start();
    return this.service;
  }

  async stop(): Promise<any> {
    await this.service.stop();
  }
}

if (require.main === module) {
  const worker = new Worker();
  worker.start().then().catch((err) => {
    console.error('startup error', err);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    worker.stop().then().catch((err) => {
      console.error('shutdown error', err);
      process.exit(1);
    });
  });
}
