'use strict';

import * as coMocha from 'co-mocha';
import * as mocha from 'mocha';
import * as Logger from '@restorecommerce/logger';
import * as should from 'should';

coMocha(mocha);
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as Renderer from '@restorecommerce/handlebars-helperized';
import * as sconfig from '@restorecommerce/service-config';
import { Events, Topic } from '@restorecommerce/kafka-client';
import { Worker } from './../service';

describe('rendering srv testing', () => {

  let worker: Worker;
  let events: Events;
  let cfg: any;
  let test_cfg: any;
  let logger: any;
  let validate: any;
  let listener: any;
  let responseID: string;
  let response: Array<string>;
  let topic: Topic;
  before(async function start() {

    cfg = sconfig(process.cwd());
    test_cfg = sconfig(process.cwd() + '/test');
    logger = new Logger(cfg.get('logger'));

    worker = new Worker();
    await worker.start(cfg, logger);

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
      events = new Events(test_cfg.get('events:kafka'), logger);
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
          templates: JSON.stringify({
            message: {
              body: msgTpl
            }
          }),
          data: JSON.stringify({
            msg: msg
          })
        }]
      };

      const renderer = new Renderer(msgTpl, '', '', {});

      validate = () => {
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-plain');
        response.length.should.equal(1);
        response[0].should.hasOwnProperty('content');
        response[0]['content'].should.be.json;
        const obj = JSON.parse(response[0]['content']);
        obj.should.hasOwnProperty('message');
        const message = obj.message;
        message.should.equal(renderer.render({ msg: msg }));
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset)
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
          templates: JSON.stringify({ message: { body: bodyTpl, layout: layoutTpl } }),
          data: JSON.stringify({ msg: msg })
        }]
      };

      const renderer = new Renderer(bodyTpl, layoutTpl, '', {});

      validate = () => {
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-layout');
        response.length.should.equal(1);
        response[0].should.hasOwnProperty('content');
        response[0]['content'].should.be.json;
        const obj = JSON.parse(response[0]['content']);
        obj.should.hasOwnProperty('message');
        const message = obj.message;
        message.should.equal(renderer.render({ msg: msg }));
      }

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
          templates: JSON.stringify({ message: { body: bodyTpl, layout: layoutTpl } }),
          data: JSON.stringify({ msg: msg }),
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
        // response[0].should.hasOwnProperty('id');
        // response[0]['id'].should.equal('test-style');
        response[0].should.hasOwnProperty('content');
        response[0]['content'].should.be.json;
        const obj = JSON.parse(response[0]['content']);
        obj.should.hasOwnProperty('message');
        const message = obj.message;
        message.should.equal(renderer.render({ msg: msg }));
      };

      const offset = await topic.$offset(-1) + 1;
      console.log('Offset', offset);
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);

      console.log('New offset', await topic.$offset(-1));
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
          templates: JSON.stringify({ message: { body: bodyTpl, layout: layoutTpl } }),
          data: JSON.stringify({ msg: msg })
        },
        // rendering two exactly equal templates
        {
          templates: JSON.stringify({ message: { body: bodyTpl, layout: layoutTpl } }),
          data: JSON.stringify({ msg: msg })
        }]
      };

      const renderer = new Renderer(bodyTpl, layoutTpl, '', {});
      const rendered = renderer.render({ msg: msg });
      validate = () => {
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-multiple');
        response.length.should.equal(2);

        response[0].should.hasOwnProperty('content');
        response[0]['content'].should.be.json;
        response[1].should.hasOwnProperty('content');
        response[1]['content'].should.be.json;

        const obj1 = JSON.parse(response[0]['content']);
        obj1.should.hasOwnProperty('message');

        const obj2 = JSON.parse(response[1]['content']);
        obj2.should.hasOwnProperty('message');

        let message = obj1.message;
        message.should.equal(renderer.render({ msg: msg }));
        message = obj2.message;
        message.should.equal(renderer.render({ msg: msg }));
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);
    });
  });
});
