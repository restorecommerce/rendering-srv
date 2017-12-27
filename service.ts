'use strict';

import * as _ from 'lodash';
import * as cheerio from 'cheerio';
import * as co from 'co';
import * as fetch from 'node-fetch';

// microservice
import { Events, Topic } from '@restorecommerce/kafka-client';
import * as Logger from '@restorecommerce/logger';
import * as Renderer from '@restorecommerce/handlebars-helperized';
import * as sconfig from '@restorecommerce/service-config';
// gRPC / command-interface
import { Server } from '@restorecommerce/chassis-srv';
import * as cis from '@restorecommerce/command-interface';

const RENDER_REQ_EVENT = 'renderRequest';
const HEALTH_CMD_EVENT = 'healthCheckCommand';
const HEALTH_RES_EVENT = 'healthCheckResponse';
enum Strategy {
  INLINE = 1,
  COPY = 2
}

export class Service {
  logger: Logger;
  cfg: any;
  events: Events;
  topics: any;
  server: Server;
  commandService: cis.CommandInterface;
  constructor(cfg: any, logger: Logger) {
    this.cfg = cfg;
    this.logger = logger;

    const eventsCfg = this.cfg.get('events:kafka');
    const renderResponseCfg = eventsCfg.renderResponse;
    // services which emit requests
    const requestEmitters = eventsCfg.requestEmitters;
    if (requestEmitters) {
      for (let service of requestEmitters) {
        eventsCfg[`${service}RenderResponse`] = _.cloneDeep(renderResponseCfg);
      }
      this.cfg.set('events:kafka', eventsCfg);
    }

    this.events = new Events(this.cfg.get('events:kafka'), this.logger);
    this.topics = {};

    this.server = new Server(cfg.get('server'), logger);
  }

  async start(): Promise<any> {
    await this.subscribeTopics();
    this.commandService = new cis.CommandInterface(this.server, null,
      this.cfg.get(), this.logger);
    const serviceNamesCfg = this.cfg.get('serviceNames');
    await co(this.server.bind(serviceNamesCfg.cis, this.commandService));
    await co(this.server.start());
  }

  async subscribeTopics(): Promise<any> {
    this.logger.info('Subscribing Kafka topics');

    await this.events.start();

    const that = this;
    const listener = async function (msg: any, context: any, config: any, eventName: string): Promise<any> {
      const response = [];
      if (eventName == RENDER_REQ_EVENT) {
        that.logger.info('Rendering request received');
        const request = msg;
        let serviceName = '';
        const id: string = request.id;
        if (!request || request.payload.length == 0) {
          response.push('Missing payload');
        } else {

          const payloads = request.payload;
          serviceName = request.service_name;

          for (let payload of payloads) {
            const templates = JSON.parse(payload.templates);
            const data = JSON.parse(payload.data);

            let options: any;
            if (payload.options) {
              options = JSON.parse(payload.options);
            }

            const renderingStrategy = payload.strategy || Strategy.INLINE;
            if (!templates || _.keys(templates).length == 0) {
              const error = { error: 'Missing templates' };
              response.push(error);
            }

            if (!data || _.keys(data).length == 0) {
              const error = { error: 'Missing data' };
              response.push(error);
            }

            let style = payload.style;
            if (style) {
              const tplResponse = await fetch(style, {});
              if (!tplResponse.ok) {
                this.logger.info('Could not retrieve CSS file from provided URL');
              } else {
                style = await tplResponse.text();
              }
            }

            const renderResponse = { content: '' };

            // renderResponse.id = id;
            const responseObj = {};
            for (let key in templates) {
              // key-value {'tplName': HBS tpl}, {'layout': HBS tpl}
              const template = templates[key];
              const body = template.body;
              const layout = template.layout; // may be null

              let tplRenderer;
              if (renderingStrategy == Strategy.INLINE) {
                tplRenderer = new Renderer(body, layout, style, options);
              } else {
                // do not inline!
                tplRenderer = new Renderer(body, layout, null, options);
              }

              let rendered = tplRenderer.render(data);  // rendered HTML string
              if (renderingStrategy == Strategy.COPY && style) {
                const html = cheerio.load(rendered);
                html('html').append('<style></style>');
                html('style').attr('type', 'text/css');
                html('style').append(style);
                rendered = html.html();
              }
              responseObj[key] = rendered;
            }

            renderResponse.content = JSON.stringify(responseObj);
            response.push(renderResponse);
          }
        }
        await that.reply(id, response, serviceName);
      } else if (eventName == HEALTH_CMD_EVENT) {
        if (msg && msg.service == that.commandService.service[msg.service]) {
          const serviceStatus = that.commandService.check(msg);
          await that.topics.command.emit(HEALTH_RES_EVENT, serviceStatus);
        }
      }
    };

    const kafkaCfg = this.cfg.get('events:kafka');
    const topicTypes = _.keys(kafkaCfg.topics);
    for (let topicType of topicTypes) {
      const topicName = kafkaCfg.topics[topicType].topic;
      this.topics[topicType] = this.events.topic(topicName);
      if (kafkaCfg.topics[topicType].events) {
        const eventNames = kafkaCfg.topics[topicType].events;
        for (let eventName of eventNames) {
          await this.topics[topicType].on(eventName, listener);
        }
      }
    }

  }

  async reply(requestID: string, response: Array<string>, serviceName?: string): Promise<any> {
    const message = {
      id: requestID,
      response: []
    };
    message.response = response;

    const eventName = serviceName ?
      serviceName + 'RenderResponse' : 'renderResponse';
    await this.topics.rendering.emit(eventName, message);
  }

  async end(): Promise<any> {
    await co(this.server.end());
    await this.events.stop();
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
      cfg = sconfig(process.cwd());
      logger = new Logger(cfg.get('logger'));
    }

    this.service = new Service(cfg, logger);
    await this.service.start();
    return this.service;
  }

  async end(): Promise<any> {
    await this.service.end();
  }
}

if (require.main === module) {
  const worker = new Worker();
  let that = this;
  worker.start().then().catch((err) => {
    that.logger.error('startup error', err);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    worker.end().then().catch((err) => {
      that.logger.error('shutdown error', err);
      process.exit(1);
    });
  });
}
