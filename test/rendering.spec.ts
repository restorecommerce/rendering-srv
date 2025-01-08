import {} from 'mocha';
import should from 'should';
import fs from 'node:fs';
import { createServer } from 'http';
import { createLogger } from '@restorecommerce/logger';
import path from 'path';
import { Renderer } from '@restorecommerce/handlebars-helperized';
import { createServiceConfig } from '@restorecommerce/service-config';
import { Events, Topic } from '@restorecommerce/kafka-client';
import { Worker } from '../src/service.js';

const HTML_CONTENT_TYPE = 'application/html';
const TEXT_CONTENT_TYPE = 'application/text';
const CSS_CONTENT_TYPE = 'text/CSS';

const staticServe = function (req: any, res: any): any {
  let fileLoc = path.resolve(process.cwd() + '/test/fixtures');
  fileLoc = path.join(fileLoc, req.url);
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
  let responses: Array<any>;
  let topic: Topic;

  before(async function start(): Promise<void> {
    cfg = createServiceConfig(process.cwd() + '/test');
    logger = createLogger(cfg.get('logger'));

    worker = new Worker();
    await worker.start(cfg, logger);

    marshall = worker.service.marshallProtobufAny;
    unmarshall = worker.service.unmarshallProtobufAny;

    listener = function (msg: any, context: any, config: any, eventName: string): void {
      if (eventName == 'renderResponse') {
        responseID = msg.id;
        responses = msg.responses;
        validate();
      }
    };
  });

  after(async function stop(): Promise<void> {
    await worker.stop();
  });

  describe('with test response listener', () => {
    before(async function start(): Promise<void> {
      events = new Events({
        ...cfg.get('events:kafka'),
        groupId: 'rendering-srv-test-runner',
        kafka: {
          ...cfg.get('events:kafka:kafka')
        }
      }, logger)
      await events.start();
      topic = await events.topic('io.restorecommerce.rendering');
      topic.on('renderResponse', listener);
    });
    after(async function stop(): Promise<void> {
      await events.stop();
    });

    it('should return missing payload response if request payload is empty', async () => {
      let renderRequest = {
        id: 'test-empty',
        payloads: []
      };
      validate = () => {
        const responseObject = { error: 'Missing payload' };
        should.exist(responseID);
        should.exist(responses);
        responseID.should.equal('test-empty');
        responses.length.should.equal(1);
        const responseStr = JSON.stringify(unmarshall(responses[0]));
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
        payloads: [{
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

      const renderer = new Renderer(msgTpl, '', '', {}, []);
      validate = () => {
        should.exist(responseID);
        should.exist(responses);
        responseID.should.equal('test-plain');
        responses.length.should.equal(1);
        responses[0].should.be.json;
        const obj = unmarshall(responses[0]);
        obj.should.hasOwnProperty('message');
        const message = obj.message;
        message.should.equal(renderer.render({ msg }));
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);
    });

    it('should render a template using custom helper "list"  ', async () => {
      // template:
      // {{#list people}}{{firstname}} {{lastname}}{{/list}}
      // input:
      // {
      //   people: [
      //     {
      //       firstname: "Yehuda",
      //       lastname: "Katz",
      //     },
      //     {
      //       firstname: "Carl",
      //       lastname: "Lerche",
      //     },
      //     {
      //       firstname: "Alan",
      //       lastname: "Johnson",
      //     },
      //   ],
      // }
      // output:
      // <ul>
      // <li>Yehuda Katz</li>
      // <li>Carl Lerche</li>
      // <li>Alan Johnson</li>
      // </ul>

      const path = cfg.get('templates:root') + cfg.get('templates:custom_helper_list:body');
      const msgTpl = fs.readFileSync(path).toString();
      const people = [{ firstname: "John", lastname: "BonJovi" }, { firstname: "Lars", lastname: "Ulrich" }];
      const renderRequest = {
        id: 'test-custom-helper-list',
        payloads: [{
          templates: marshall({
            message: {
              body: msgTpl
            }
          }),
          data: marshall({
            people
          }),
          content_type: TEXT_CONTENT_TYPE
        }]
      };

      const renderer = new Renderer(msgTpl, '', '', {}, []);

      validate = () => {
        should.exist(responseID);
        should.exist(responses);
        responseID.should.equal('test-custom-helper-list');
        responses.length.should.equal(1);
        responses[0].should.be.json;
        let obj = unmarshall(responses[0]);
        obj.should.hasOwnProperty('message');
        let message = obj.message;
        message.should.equal(renderer.render({ people }));
      };

      const offset = await topic.$offset(-1) + 1;
      await topic.emit('renderRequest', renderRequest);
      await topic.$wait(offset);
    });

    it('should test equal custom helper', async () => {
      const path = cfg.get('templates:root') + cfg.get('templates:custom_helper_eq:body');
      const msgTpl = fs.readFileSync(path).toString();
      const indicationStrategy = 'request_service_by_indication';
      const renderRequest = {
        id: 'test-custom-helper-eq',
        payloads: [{
          templates: marshall({
            message: {
              body: msgTpl
            }
          }),
          data: marshall({
            indicationStrategy
          }),
          content_type: TEXT_CONTENT_TYPE
        }]
      };
      const renderer = new Renderer(msgTpl, '', '', {}, []);
      validate = () => {
        should.exist(responseID);
        should.exist(responses);
        responseID.should.equal('test-custom-helper-eq');
        responses.length.should.equal(1);
        responses[0].should.be.json;
        let obj = unmarshall(responses[0]);
        obj.should.hasOwnProperty('message');
        let message = obj.message;
        message.should.equal(renderer.render({ indicationStrategy }));
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
        payloads: [{
          templates: marshall({
            message: { body: bodyTpl, layout: layoutTpl },
          }),
          data: marshall({ msg }),
          content_type: HTML_CONTENT_TYPE
        }]
      };

      const renderer = new Renderer(bodyTpl, layoutTpl, '', {}, []);

      validate = () => {
        should.exist(responseID);
        should.exist(responses);
        responseID.should.equal('test-layout');
        responses.length.should.equal(1);
        responses[0].should.be.json;
        const obj = unmarshall(responses[0]);
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
      const httpServer = createServer(staticServe);
      httpServer.listen(cfg.get('static_server:port'));

      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_style');
      const bodyTpl = fs.readFileSync(root + templates.body).toString();
      const layoutTpl = fs.readFileSync(root + templates.layout).toString();
      const stylesUrl = prefix + templates.style;

      const msg = 'Hello World!';

      const renderRequest = {
        id: 'test-style',
        payloads: [{
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl } }),
          data: marshall({ msg }),
          style_url: stylesUrl,
          content_type: CSS_CONTENT_TYPE
        }]
      };

      const stylesPath = templates.style;
      const style = fs.readFileSync(root + stylesPath).toString();
      const renderer = new Renderer(bodyTpl, layoutTpl, style, {}, []);

      validate = () => {
        should.exist(responseID);
        should.exist(responses);
        responseID.should.equal('test-style');
        responses.length.should.equal(1);
        responses[0].should.be.json;
        const obj = unmarshall(responses[0]);
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
        payloads: [{
          templates: marshall({ message: { body: bodyTpl, layout: layoutTpl } }),
          data: marshall({ msg }),
          style_url: stylesUrl,
          content_type: CSS_CONTENT_TYPE
        }]
      };

      const stylesPath = templates.style;
      const style = fs.readFileSync(root + stylesPath).toString();
      const renderer = new Renderer(bodyTpl, layoutTpl, style, {}, []);

      validate = () => {
        should.exist(responseID);
        should.exist(responses);
        responseID.should.equal('test-style');
        responses.length.should.equal(2);
        responses[0].should.be.json;
        responses[1].should.be.json;
        const response_0 = unmarshall(responses[0]);
        const response_1 = unmarshall(responses[1]);
        const expectedObj = {
          error: 'request to http://invalidurl/main.css ' +
            'failed, reason: getaddrinfo (EAI_AGAIN|ENOTFOUND) ' +
            'invalidurl'
        };
        JSON.stringify(response_0).should.match(new RegExp(JSON.stringify(expectedObj)));
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
        payloads: [{
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

      const renderer = new Renderer(bodyTpl, layoutTpl, '', {}, []);
      validate = () => {
        should.exist(responseID);
        should.exist(responses);
        responseID.should.equal('test-multiple');
        responses.length.should.equal(2);
        responses.forEach(element => {
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
      const httpServer = createServer(staticServe);
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
        payloads: [{
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
      const renderer = new Renderer(bodyTpl, layoutTpl, style, {}, []);
      validate = () => {
        should.exist(responseID);
        should.exist(responses);
        responseID.should.equal('test-complex-css');
        responses.length.should.equal(2);
        responses.forEach(element => {
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
