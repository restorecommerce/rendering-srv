import {} from 'mocha';
import should from 'should';
import fs from 'node:fs';
import { createServer } from 'http';
import { createLogger } from '@restorecommerce/logger';
import path from 'path';
import { Renderer } from '@restorecommerce/handlebars-helperized';
import { createServiceConfig } from '@restorecommerce/service-config';
import { Events, Topic } from '@restorecommerce/kafka-client';
import { Worker } from '../src/worker.js';
import {
  marshallProtobufAny as marshall,
  unmarshallProtobufAny as unmarshall,
} from '../src/utils.js';
import { RenderRequestList, RenderResponseList } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/rendering.js';
import { ResourceAwaitQueue } from './ResourceAwaitQueue.js';

const HTML_CONTENT_TYPE = 'application/html';
const TEXT_CONTENT_TYPE = 'application/text';
const CSS_CONTENT_TYPE = 'text/CSS';
const renderResultAwaitingQueue = new ResourceAwaitQueue<RenderResponseList>();

function staticServe(req: any, res: any): any {
  let fileLoc = path.resolve(process.cwd() + '/test/fixtures');
  fileLoc = path.join(fileLoc, req.url);
  const file = fs.readFileSync(fileLoc);
  res.writeHead(200, { 'Content-Type': 'text/css' });
  res.write(file);
  return res.end();
};

function listener(msg: RenderResponseList): void {
  renderResultAwaitingQueue.resolve(msg.id!, msg);
};

/*
 * Note: To run this test, a running kafka and redis instance is required.
 */
describe('Testing Rendering-srv', () => {
  let worker: Worker;
  let events: Events;
  let cfg: any;
  let logger: any;
  let topic: Topic;

  before(async function start(): Promise<void> {
    cfg = createServiceConfig(process.cwd());
    logger = createLogger(cfg.get('logger'));
    worker = new Worker(cfg, logger);
    await worker.start();
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
      const renderRequest: RenderRequestList  = {
        id: 'test-empty'
      };
      
      await topic.emit('renderRequest', renderRequest);
      const renderResponse = await renderResultAwaitingQueue.await(renderRequest.id!, 5000);

      should.equal(
        renderResponse.id,
        renderRequest.id,
        'renderResponse.id should equal renderRequest.id'
      );
      should.equal(
        renderResponse.operation_status?.code,
        400,
        'operation_status.code should equal 400'
      );
      should.equal(
        renderResponse.operation_status?.message,
        'Empty request!',
        'operation_status.message should equal "Empty request!"'
      );
    });

    it('should render a plain template with no layouts or styles', async () => {
      const path = cfg.get('templates:root') + cfg.get('templates:simple_message:body');
      const msgTpl = fs.readFileSync(path);
      const data = { msg: 'Hello World!' };
      const renderRequest: RenderRequestList = {
        id: 'test-plain',
        items: [{
          templates: [{
            body: msgTpl
          }],
          data: marshall(data),
          content_type: TEXT_CONTENT_TYPE
        }],
      };

      const rendered = await new Renderer(msgTpl.toString()).render(data);
      await topic.emit('renderRequest', renderRequest);
      const renderResponse = await renderResultAwaitingQueue.await(renderRequest.id!, 5000);

      should.equal(
        renderResponse.id,
        renderRequest.id,
        'renderResponse.id should equal renderRequest.id'
      );
      should.equal(
        renderResponse.items?.[0]?.payload?.bodies?.[0]?.body?.toString(),
        rendered,
        'renderResponse bodies should equal test rendering'
      );
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
      const msgTpl = fs.readFileSync(path);
      const data = {
        people: [
          { firstname: "John", lastname: "BonJovi" },
          { firstname: "Lars", lastname: "Ulrich" }
        ]
      };
      const renderRequest: RenderRequestList = {
        id: 'test-custom-helper-list',
        items: [{
          templates: [{
            body: msgTpl
          }],
          data: marshall(data),
          content_type: TEXT_CONTENT_TYPE
        }],
      };

      const rendered = await new Renderer(msgTpl.toString()).render(data);
      await topic.emit('renderRequest', renderRequest);
      const renderResponse = await renderResultAwaitingQueue.await(renderRequest.id!, 5000);

      should.equal(
        renderResponse.id,
        renderRequest.id,
        'renderResponse.id should equal renderRequest.id'
      );
      should.equal(
        renderResponse.items?.[0]?.payload?.bodies?.[0]?.body?.toString(),
        rendered,
        'renderResponse bodies should equal test rendering'
      );
    });

    it('should test equal custom helper', async () => {
      const path = cfg.get('templates:root') + cfg.get('templates:custom_helper_eq:body');
      const msgTpl = fs.readFileSync(path);
      const data = {
        indicationStrategy: 'request_service_by_indication'
      };
      const renderRequest: RenderRequestList = {
        id: 'test-custom-helper-eq',
        items: [{
          templates: [{
            body: msgTpl
          }],
          data: marshall(data),
          content_type: TEXT_CONTENT_TYPE
        }],
      };

      const rendered = await new Renderer(msgTpl.toString()).render(data);
      await topic.emit('renderRequest', renderRequest);
      const renderResponse = await renderResultAwaitingQueue.await(renderRequest.id!, 5000);

      should.equal(
        renderResponse.id,
        renderRequest.id,
        'renderResponse.id should equal renderRequest.id'
      );
      should.equal(
        renderResponse.items?.[0]?.payload?.bodies?.[0]?.body?.toString(),
        rendered,
        'renderResponse bodies should equal test rendering'
      );
    });

    it('should render with layout', async () => {
      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_layout');
      const body = fs.readFileSync(root + templates.body);
      const layout = fs.readFileSync(root + templates.layout);
      const data = { msg: 'Hello World!' };
      const renderRequest: RenderRequestList = {
        id: 'test-layout',
        items: [{
          templates: [{
            body,
            layout,
          }],
          data: marshall(data),
          content_type: HTML_CONTENT_TYPE
        }],
      };
      
      const rendered = await new Renderer(body.toString(), layout.toString()).render(data);
      await topic.emit('renderRequest', renderRequest);
      const renderResponse = await renderResultAwaitingQueue.await(renderRequest.id!, 5000);

      should.equal(
        renderResponse.id,
        renderRequest.id,
        'renderResponse.id should equal renderRequest.id'
      );
      should.equal(
        renderResponse.items?.[0]?.payload?.bodies?.[0]?.body?.toString(),
        rendered,
        'renderResponse bodies should equal test rendering'
      );
    });

    it('should render with external stylesheet', async () => {
      const prefix = `${cfg.get('static_server:prefix')}:${cfg.get('static_server:port')}/`;
      // setting static server to serve templates over HTTP
      const httpServer = createServer(staticServe);
      httpServer.listen(cfg.get('static_server:port'));

      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_style');
      const stylesUrl = prefix + templates.style;
      const body = fs.readFileSync(root + templates.body);
      const layout = fs.readFileSync(root + templates.layout);
      const style = fs.readFileSync(root + templates.style).toString();
      const data = { msg: 'Hello World!' };
      const renderRequest: RenderRequestList = {
        id: 'test-style',
        items: [{
          templates: [{
            body,
            layout,
          }],
          data: marshall(data),
          style_url: stylesUrl,
          content_type: CSS_CONTENT_TYPE
        }],
      };
      
      const rendered = await new Renderer(body.toString(), layout.toString(), style).render(data);
      await topic.emit('renderRequest', renderRequest);
      const renderResponse = await renderResultAwaitingQueue.await(renderRequest.id!, 5000);

      should.equal(
        renderResponse.id,
        renderRequest.id,
        'renderResponse.id should equal renderRequest.id'
      );
      should.equal(
        renderResponse.items?.[0]?.payload?.bodies?.[0]?.body?.toString(),
        rendered,
        'renderResponse bodies should equal test rendering'
      );

      httpServer.close();
    });

    it('should render without css for missing stylesheet', async () => {
      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_style');
      const stylesUrl = 'http://invalidURL/main.css';
      const body = fs.readFileSync(root + templates.body);
      const layout = fs.readFileSync(root + templates.layout);
      const style = fs.readFileSync(root + templates.style).toString();
      const data = { msg: 'Hello World!' };
      const renderRequest: RenderRequestList = {
        id: 'test-missing-style',
        items: [{
          templates: [{
            body,
            layout,
          }],
          data: marshall(data),
          style_url: stylesUrl,
          content_type: CSS_CONTENT_TYPE
        }],
      };

      const rendered = await new Renderer(body.toString(), layout.toString(), style).render(data);
      await topic.emit('renderRequest', renderRequest);
      const renderResponse = await renderResultAwaitingQueue.await(renderRequest.id!, 5000);
      const renderResult = renderResponse.items?.[0]?.payload?.bodies?.[0]?.body?.toString();

      should.equal(
        renderResponse.id,
        renderRequest.id,
        'renderResponse.id should equal renderRequest.id'
      );
      should.equal(
        renderResponse.items?.[0].status?.code,
        500,
        'renderResponse.status.code should equal 500'
      );
      should.equal(
        renderResponse.items?.[0].status?.message,
        'fetch failed',
        'renderResponse.status.message should equal "fetch failed"'
      );
      should.notEqual(
        renderResult,
        rendered,
        'renderResult should not equal test rendering due to missing style'
      );
      renderResult!.should.match(
        /My test message: Hello World!/,
        'renderResult should ignore missing style and match "My test message: Hello World!"'
      );
    });

    it('should render multiple templates', async () => {
      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_layout');
      const body = fs.readFileSync(root + templates.body);
      const layout = fs.readFileSync(root + templates.layout);
      const data = { msg: 'Hello World!' };
      const renderRequest: RenderRequestList = {
        id: 'test-multiple',
        items: [{
          id: '1',
          templates: [{
            body,
            layout,
          }],
          data: marshall(data),
          content_type: TEXT_CONTENT_TYPE
        },{
          id: '2',
          templates: [{
            body,
            layout,
          }],
          data: marshall(data),
          content_type: TEXT_CONTENT_TYPE
        }],
      };

      const rendered = await new Renderer(body.toString(), layout.toString()).render(data);
      await topic.emit('renderRequest', renderRequest);
      const renderResponse = await renderResultAwaitingQueue.await(renderRequest.id!, 5000);

      should.equal(
        renderResponse.id,
        renderRequest.id,
        'renderResponse.id should equal renderRequest.id'
      );

      renderResponse.items!.forEach(
        (item, i) => {
          should.equal(
            item?.payload?.id,
            renderRequest.items![i].id,
            'renderResponse item id should equal renderRequest item id in same order'
          );
          should.equal(
            item?.payload?.bodies?.[0]?.body?.toString(),
            rendered,
            'renderResponse bodies should equal test rendering in same order'
          );
        }
      );
    });

    it('Should render CSS inline on complex template', async () => {
      const prefix = `${cfg.get('static_server:prefix')}:${cfg.get('static_server:port')}/`;
      // setting static server to serve templates over HTTP
      const httpServer = createServer(staticServe);
      httpServer.listen(cfg.get('static_server:port'));
      const root = cfg.get('templates:root');
      const templates = cfg.get('templates:message_with_inline_css');
      const body = fs.readFileSync(root + templates.body);
      const layout = fs.readFileSync(root + templates.layout);
      const style = fs.readFileSync(root + templates.style).toString();
      const stylesUrl = prefix + templates.style;

      // Template variables
      const data = {
        firstName: 'Max',
        lastName: 'Mustermann',
        companyName: 'VCL Company SE',
        streetAddress: 'Somestreet 45',
        cityCodeAdress: '70174 Stuttgart',
        invoiceNo: '2017110800169',
        invoiceDate: '19.09.2019',
        paymentStatus: 'unpaid',
        customerNo: '1694923665',
        vatIdNo: 'DE000000000',
        billingStreet: 'Mustermannstrasse 10',
        billingCity: 'Stuttgart',
        billingCountry: 'Germany',
        livingStreet: 'Mustermannstrasse 12',
        livingCity: 'Berlin',
        livingCountry: 'Germany',
        item1description: 'Article 23784628',
        item1quantity: '1',
        item1vat: '19%',
        item1amount: '12.00',
        item2description: 'Article 34895789',
        item2quantity: '1 000',
        item2vat: '19%',
        item2amount: '11,111.11',
        item3description: 'Article 89054373',
        item3quantity: '2',
        item3vat: '7%',
        item3amount: '1.15',
        subTotalGross: '27,689.22',
        subTotalNet: '23,384.22',
        vat1total: '4,224.50',
        vat2total: '80.50',
        billTotal: '27,689.22',
        accountBank: 'Deutsche Bank AG',
        accountIban: 'DE60200700000000000000',
        accountBic: 'DEUTDEXXXXX',
        accountPurpose: '2017110800169',
        saleTerms: 'Terms, more terms, even more terms.',
      };

      const renderRequest: RenderRequestList = {
        id: 'test-complex-css',
        items: [{
          templates: [{
            body,
            layout,
          }],
          data: marshall(data),
          style_url: stylesUrl,
          content_type: CSS_CONTENT_TYPE
        }],
      };

      const rendered = await new Renderer(body.toString(), layout.toString(), style).render(data);
      await topic.emit('renderRequest', renderRequest);
      const renderResponse = await renderResultAwaitingQueue.await(renderRequest.id!, 5000);

      should.equal(
        renderResponse.id,
        renderRequest.id,
        'renderResponse.id should equal renderRequest.id'
      );
      should.equal(
        renderResponse.items?.[0]?.payload?.bodies?.[0]?.body?.toString(),
        rendered,
        'renderResponse bodies should equal test rendering'
      );

      httpServer.close();
    });
  });
});
