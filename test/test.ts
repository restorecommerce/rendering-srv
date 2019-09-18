'use strict';

import * as mocha from 'mocha';
import * as should from 'should';

import * as fs from 'fs';
import * as http from 'http';
import { Logger } from '@restorecommerce/logger';
import * as path from 'path';
import * as Renderer from '@restorecommerce/handlebars-helperized';
import * as sconfig from '@restorecommerce/service-config';
import { Events, Topic } from '@restorecommerce/kafka-client';
import { Worker } from './../service';

const HTML_CONTENT_TYPE = 'application/html';
const TEXT_CONTENT_TYPE = 'application/text';
const CSS_CONTENT_TYPE = 'text/CSS';

const staticServe = function (req: any, res: any): any {
  let fileLoc = path.resolve(process.cwd() + '/test/fixtures');
  fileLoc = path.join(fileLoc, req.url);

  const extname = path.extname(fileLoc);
  const file = fs.readFileSync(fileLoc);
  res.writeHead(200, { 'Content-Type': 'text/css' });
  res.write(file);
  return res.end();
};

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
  before(async function start(): Promise<void> {

    cfg = sconfig(process.cwd() + '/test');
    logger = new Logger(cfg.get('logger'));

    worker = new Worker();
    await worker.start(cfg, logger);

    marshall = worker.service.marshallProtobufAny;
    unmarshall = worker.service.unmarshallProtobufAny;

    listener = function (msg: any, context: any, config: any, eventName: string): void {
      if (eventName == 'renderResponse') {
        responseID = msg.id;
        response = msg.response;
        validate();
      }
    };
  });

  after(async function stop(): Promise<void> {
    await worker.stop();
  });

  describe('with test response listener', () => {
    before(async function start(): Promise<void> {
      events = new Events(cfg.get('events:kafka'), logger);
      await events.start();
      topic = events.topic('io.restorecommerce.rendering');
      topic.on('renderResponse', listener);
    });
    after(async function stop(): Promise<void> {
      await events.stop();
    });
    it('should return missing payload response if request payload is empty', async () => {
      let renderRequest = {
        id: 'test-empty',
        payload: []
      };
      validate = () => {
        const responseObject = { error: 'Missing payload' };
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-empty');
        response.length.should.equal(1);
        const responseStr = JSON.stringify(unmarshall(response[0]));
        responseStr.should.equal(JSON.stringify(responseObject));
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
              body: msgTpl
            }
          }),
          data: marshall({
            msg
          }),
          content_type: TEXT_CONTENT_TYPE
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
        message.should.equal(renderer.render({ msg }));
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
            message: { body: bodyTpl, layout: layoutTpl },
          }),
          data: marshall({ msg }),
          content_type: HTML_CONTENT_TYPE
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
        message.should.equal(renderer.render({ msg }));
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);
    });

    it('should render with external stylesheet', async () => {
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
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl } }),
          data: marshall({ msg }),
          style_url: stylesUrl,
          content_type: CSS_CONTENT_TYPE
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
        message.should.equal(renderer.render({ msg }));
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);

      httpServer.close();
    });

    it('should render without css for missing stylesheet', async () => {

      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_style');
      const bodyTpl = fs.readFileSync(root + templates.body).toString();
      const layoutTpl = fs.readFileSync(root + templates.layout).toString();
      const stylesUrl = 'http://invalidURL/main.css';

      const msg = 'Hello World!';

      const renderRequest = {
        id: 'test-style',
        payload: [{
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl } }),
          data: marshall({ msg }),
          style_url: stylesUrl,
          content_type: CSS_CONTENT_TYPE
        }]
      };

      const stylesPath = templates.style;
      const style = fs.readFileSync(root + stylesPath).toString();
      const renderer = new Renderer(bodyTpl, layoutTpl, style, {});

      validate = () => {
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-style');
        response.length.should.equal(2);
        response[0].should.be.json;
        response[1].should.be.json;
        const response_0 = unmarshall(response[0]);
        const response_1 = unmarshall(response[1]);
        const expectedObj = {
          error: 'request to http://invalidurl/main.css ' +
            'failed, reason: getaddrinfo ENOTFOUND ' +
            'invalidurl'
        };
        JSON.stringify(response_0).should.equal(JSON.stringify(expectedObj));
        response_1.should.hasOwnProperty('message');
        const message = response_1.message;
        message.should.equal('<div>\n    <p>My test message: Hello World!</p>\n</div>\n');
      };
      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);
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
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl } }),
          data: marshall({ msg }),
          content_type: TEXT_CONTENT_TYPE
        },
        // rendering two exactly equal templates
        {
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl, contentType: TEXT_CONTENT_TYPE } }),
          data: marshall({ msg }),
          content_type: TEXT_CONTENT_TYPE
        }]
      };

      const renderer = new Renderer(bodyTpl, layoutTpl, '', {});
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
          message.should.equal(renderer.render({ msg }));
        });
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);
    });

    it('Should render CSS inline on complex template', async () => {
      const prefix = `${cfg.get('static_server:prefix')}:${cfg.get('static_server:port')}/`;
      // setting static server to serve templates over HTTP
      const httpServer = http.createServer(staticServe);
      httpServer.listen(cfg.get('static_server:port'));

      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_inline_css');
      const bodyTpl = fs.readFileSync(root + templates.body).toString();
      const layoutTpl = fs.readFileSync(root + templates.layout).toString();
      const stylesUrl = prefix + templates.style;

      // Template variables
      const firstName = 'Max';
      const lastName = 'Mustermann';
      const companyName = 'VCL Company SE';
      const streetAddress = 'Somestreet 45';
      const cityCodeAdress = '70174 Stuttgart';
      const invoiceNo = '2017110800169';
      const invoiceDate = '19.09.2019';
      const paymentStatus = 'unpaid';
      const customerNo = '1694923665';
      const vatIdNo = 'DE000000000';
      const billingStreet = 'Mustermannstrasse 10';
      const billingCity = 'Stuttgart';
      const billingCountry = 'Germany';
      const livingStreet = 'Mustermannstrasse 12';
      const livingCity = 'Berlin';
      const livingCountry = 'Germany';
      const item1description = 'Article 23784628';
      const item1quantity = '1';
      const item1vat = '19%';
      const item1amount = '12.00';
      const item2description = 'Article 34895789';
      const item2quantity = '1 000';
      const item2vat = '19%';
      const item2amount = '11,111.11';
      const item3description = 'Article 89054373';
      const item3quantity = '2';
      const item3vat = '7%';
      const item3amount = '1.15';
      const subTotalGross = '27,689.22';
      const subTotalNet = '23,384.22';
      const vat1total = '4,224.50';
      const vat2total = '80.50';
      const billTotal = '27,689.22';
      const accountBank = 'Deutsche Bank AG';
      const accountIban = 'DE60200700000000000000';
      const accountBic = 'DEUTDEXXXXX';
      const accountPurpose = '2017110800169';
      const saleTerms = 'Terms, more terms, even more terms.';

      const renderRequest = {
        id: 'test-complex-css',
        payload: [{
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl } }),
          data: marshall({
            firstName, lastName, companyName, streetAddress, cityCodeAdress, invoiceNo, invoiceDate,
            paymentStatus, customerNo, vatIdNo, billingStreet, billingCity, billingCountry, livingStreet,
            livingCity, livingCountry, item1description, item1quantity, item1vat, item1amount, item2description,
            item2quantity, item2vat, item2amount, item3description, item3quantity, item3vat, item3amount,
            subTotalGross, subTotalNet, vat1total, vat2total, billTotal, accountBank, accountIban, accountBic,
            accountPurpose, saleTerms
          }),
          style_url: stylesUrl,
          content_type: 'application/html'
        },
        // rendering two exactly equal templates
        {
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl, contentType: 'application/html' } }),
          data: marshall({
            firstName, lastName, companyName, streetAddress, cityCodeAdress, invoiceNo, invoiceDate,
            paymentStatus, customerNo, vatIdNo, billingStreet, billingCity, billingCountry, livingStreet,
            livingCity, livingCountry, item1description, item1quantity, item1vat, item1amount, item2description,
            item2quantity, item2vat, item2amount, item3description, item3quantity, item3vat, item3amount,
            subTotalGross, subTotalNet, vat1total, vat2total, billTotal, accountBank, accountIban, accountBic,
            accountPurpose, saleTerms
          }),
          style_url: stylesUrl,
          content_type: 'application/html'
        }]
      };

      const stylesPath = templates.style;
      const style = fs.readFileSync(root + stylesPath).toString();
      const renderer = new Renderer(bodyTpl, layoutTpl, style, {});
      validate = () => {
        should.exist(responseID);
        should.exist(response);
        responseID.should.equal('test-complex-css');
        response.length.should.equal(2);
        response.forEach(element => {
          const obj = unmarshall(element);
          obj.should.be.json;
          obj.should.hasOwnProperty('message');
          const message = obj.message;
          message.should.equal(renderer.render({
            firstName, lastName, companyName, streetAddress, cityCodeAdress, invoiceNo, invoiceDate,
            paymentStatus, customerNo, vatIdNo, billingStreet, billingCity, billingCountry, livingStreet,
            livingCity, livingCountry, item1description, item1quantity, item1vat, item1amount, item2description,
            item2quantity, item2vat, item2amount, item3description, item3quantity, item3vat, item3amount,
            subTotalGross, subTotalNet, vat1total, vat2total, billTotal, accountBank, accountIban, accountBic,
            accountPurpose, saleTerms
          }));
        });
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);

      httpServer.close();
    });
  });
});
