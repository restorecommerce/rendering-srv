'use strict';

import * as mocha from 'mocha';
import * as should from 'should';

import * as fs from 'fs';
import * as http from 'http';
import * as Logger from '@restorecommerce/logger';
import * as path from 'path';
import * as Renderer from '@restorecommerce/handlebars-helperized';
import * as sconfig from '@restorecommerce/service-config';
import { Events, Topic } from '@restorecommerce/kafka-client';
import { Worker } from './../service';

const HTML_CONTENT_TYPE = 'application/html';
const TEXT_CONTENT_TYPE = 'application/text';

/*
 * Note: To run this test, a running kafka and redis instance is required.
 */
describe('rendering srv testing', () => {

  let worker: Worker;
  let events: Events;

  let cfg: any;
  let logger: any;

  let validate: any;
  let marshall: any;
  let unmarshall: any;
  let listener: any;

  let responseID: string;
  let response: Array<any>;
  let topic: Topic;
  before(async function start() {

    cfg = sconfig(process.cwd() + '/test');
    logger = new Logger(cfg.get('logger'));

    worker = new Worker();
    await worker.start(cfg, logger);

    marshall = worker.service.marshallProtobufAny;
    unmarshall = worker.service.unmarshallProtobufAny;

    listener = function (msg: any, context: any, config: any, eventName: string) {
      if (eventName == 'renderResponse') {
        responseID = msg.id;
        response = msg.response;
        validate();
      }
    };
  });

  after(async function stop() {
    await worker.stop();
  });

  describe('with test response listener', () => {
    before(async function start() {
      events = new Events(cfg.get('events:kafka'), logger);
      await events.start();
      topic = events.topic('io.restorecommerce.rendering');
      topic.on('renderResponse', listener);
    });
    after(async function stop() {
      await events.stop();
    });
    it('should return empty response if request payload is empty', async () => {
      let renderRequest = {
        id: 'test-empty',
        payload: []
      };
      validate = () => {
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-empty');
        response.length.should.equal(1);
        response[0].should.be.empty();
      };
      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);
    });

    it('should render a plain template with no layouts or styles', async () => {
      const path = cfg.get('templates:root') + cfg.get('templates:simple_message:body');
      const msgTpl = fs.readFileSync(path).toString();
      const msg = 'Hello World!';
      const renderRequest = {
        id: 'test-plain',
        payload: [{
          templates: marshall({
            message: {
              body: msgTpl,
              contentType: TEXT_CONTENT_TYPE
            }
          }),
          data: marshall({
            msg
          })
        }]
      };

      const renderer = new Renderer(msgTpl, '', '', {});

      validate = () => {
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-plain');
        response.length.should.equal(1);
        response[0].should.be.json;
        const obj = unmarshall(response[0]);
        obj.should.hasOwnProperty('message');
        const message = obj.message;
        message.should.equal(renderer.render({ msg }, TEXT_CONTENT_TYPE));
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);
    });

    it('should render with layout', async () => {
      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_layout');

      const bodyTpl = fs.readFileSync(root + templates.body).toString();
      const layoutTpl = fs.readFileSync(root + templates.layout).toString();
      const msg = 'Hello World!';

      const renderRequest = {
        id: 'test-layout',
        payload: [{
          templates: marshall({
            message: { body: bodyTpl, layout: layoutTpl, contentType: HTML_CONTENT_TYPE },
          }),
          data: marshall({ msg })
        }]
      };

      const renderer = new Renderer(bodyTpl, layoutTpl, '', {});

      validate = () => {
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-layout');
        response.length.should.equal(1);
        response[0].should.be.json;
        const obj = unmarshall(response[0]);
        obj.should.hasOwnProperty('message');
        const message = obj.message;
        message.should.equal(renderer.render({ msg }, HTML_CONTENT_TYPE));
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);
    });

    it('should render with external stylesheet', async () => {
      const staticServe = function (req: any, res: any): any {
        let fileLoc = path.resolve(process.cwd() + '/test/fixtures');
        fileLoc = path.join(fileLoc, req.url);

        const extname = path.extname(fileLoc);
        const file = fs.readFileSync(fileLoc);
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.write(file);
        return res.end();
      };

      const prefix = `${cfg.get('static_server:prefix')}:${cfg.get('static_server:port')}/`;
      // setting static server to serve templates over HTTP
      const httpServer = http.createServer(staticServe);
      httpServer.listen(cfg.get('static_server:port'));

      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_style');
      const bodyTpl = fs.readFileSync(root + templates.body).toString();
      const layoutTpl = fs.readFileSync(root + templates.layout).toString();
      const stylesUrl = prefix + templates.style;

      const msg = 'Hello World!';

      const renderRequest = {
        id: 'test-style',
        payload: [{
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl, contentType: 'text/CSS' } }),
          data: marshall({ msg }),
          style: stylesUrl
        }]
      };

      const stylesPath = templates.style;
      const style = fs.readFileSync(root + stylesPath).toString();
      const renderer = new Renderer(bodyTpl, layoutTpl, style, {});

      validate = () => {
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-style');
        response.length.should.equal(1);
        response[0].should.be.json;
        const obj = unmarshall(response[0]);
        obj.should.hasOwnProperty('message');
        const message = obj.message;
        message.should.equal(renderer.render({ msg }, 'text/CSS'));
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);

      httpServer.close();
    });

    it('should render multiple templates', async () => {
      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_layout');

      const bodyTpl = fs.readFileSync(root + templates.body).toString();
      const layoutTpl = fs.readFileSync(root + templates.layout).toString();
      const msg = 'Hello World!';

      const renderRequest = {
        id: 'test-multiple',
        payload: [{
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl, contentType: TEXT_CONTENT_TYPE } }),
          data: marshall({ msg })
        },
        // rendering two exactly equal templates
        {
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl, contentType: TEXT_CONTENT_TYPE } }),
          data: marshall({ msg })
        }]
      };

      const renderer = new Renderer(bodyTpl, layoutTpl, '', {});
      const rendered = renderer.render({ msg }, TEXT_CONTENT_TYPE);
      validate = () => {
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-multiple');
        response.length.should.equal(2);
        response.forEach(element => {
          const obj = unmarshall(element);
          obj.should.be.json;
          obj.should.hasOwnProperty('message');
          const message = obj.message;
          message.should.equal(renderer.render({ msg }, TEXT_CONTENT_TYPE));
        });
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);
    });

    it('Should render CSS inline on complex template', async () => {

      const prefix = `${cfg.get('static_server:prefix')}:${cfg.get('static_server:port')}/`;

      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_inline_css');
      const bodyTpl = fs.readFileSync(root + templates.body).toString();
      const msg = 'Hello World!';

      const stylesPath = templates.style;
      const style = fs.readFileSync(root + stylesPath).toString();
      const renderer = new Renderer(bodyTpl, '', style, {});
      const rendered = renderer.render({ msg }, HTML_CONTENT_TYPE);
      validate = () => {
        should.exist(rendered);
        rendered.split('style').length.should.equal(128);
      };
    });
  });
});
