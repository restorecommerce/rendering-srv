import * as sconfig from '@restorecommerce/service-config';
import {Logger} from '@restorecommerce/logger';
import {grpcClient} from '@restorecommerce/grpc-client';

const cfg = sconfig(process.cwd());
const logger = new Logger(cfg.get('logger'));

const grpcConfig = cfg.get('server:transports')[0];

grpcConfig['service'] = grpcConfig['services'][cfg.get('serviceNames:cis')];
grpcConfig['protos'] = ['io/restorecommerce/commandinterface.proto'];
grpcConfig['timeout'] = 3000;

logger.silly("Connecting to: " + 'grpc://' + grpcConfig['addr']);

const client = new grpcClient(grpcConfig, logger);
const command = client.makeEndpoint('command', 'grpc://' + grpcConfig['addr']);

const requests: Promise<any>[] = [];

Object.keys(grpcConfig['services']).forEach((service) => {
  requests.push(new Promise<any>(async (resolve, reject) => {
    try {
      const value = new Buffer(JSON.stringify({service})).toString('base64');
      const fullPayload = {name: 'health_check', payload: {type_url: 'payload', value}};

      logger.silly("Executing: " + JSON.stringify(fullPayload));

      const response = await command(fullPayload);

      if ('data' in response && 'value' in response.data) {
        const decoded = Buffer.from(response.data.value, 'base64').toString();
        const realValue = JSON.parse(decoded);
        if ('status' in realValue) {
          if (realValue.status !== 'SERVING') {
            logger.error(service + ' is down: ' + realValue.status);
            reject();
          } else {
            logger.silly(service + ' is serving');
            resolve();
          }
        } else {
          logger.error('ERROR!', realValue);
          reject();
        }
      } else {
        logger.error('ERROR!', response);
        reject();
      }
    } catch (e) {
      logger.error('ERROR!', e);
      reject();
    }
  }));
});

// Force exit as sometimes there is a hanging thread
Promise.all(requests).catch(() => {
  process.exit(1);
}).then(() => {
  process.exit(0);
});
