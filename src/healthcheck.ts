import { createServiceConfig } from '@restorecommerce/service-config';
import { createLogger } from '@restorecommerce/logger';
import { grpcClient } from '@restorecommerce/grpc-client';

const cfg = createServiceConfig(process.cwd());
const logger = createLogger(cfg.get('logger'));

setTimeout(() => {
  logger.error('Healthcheck timed out!');
  process.exit(2);
}, 60000);

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception: ', { error });
  process.exit(3);
});

process.on('unhandledRejection', (error, promise) => {
  logger.error('Unhandled rejected promise: ', { promise, error });
  process.exit(4);
});

const grpcConfig = cfg.get('server:transports')[0];

grpcConfig['service'] = grpcConfig['services'][cfg.get('serviceNames:cis')];
grpcConfig['protos'] = ['io/restorecommerce/commandinterface.proto'];
grpcConfig['timeout'] = 3000;

logger.silly('Connecting to: ' + 'grpc://' + grpcConfig['addr']);

const client = new grpcClient(grpcConfig, logger);
const command = client.makeEndpoint('command', 'grpc://' + grpcConfig['addr']);

const requests: Promise<any>[] = [];

Object.keys(grpcConfig['services']).forEach((service) => {
  requests.push(new Promise<void>(async (resolve, reject) => {
    try {
      const value = new Buffer(JSON.stringify({ service })).toString('base64');
      const fullPayload = { name: 'health_check', payload: { type_url: 'payload', value } };

      logger.silly('Executing: ' + JSON.stringify(fullPayload));

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
          logger.error('Unexpected health_check response:', realValue);
          reject();
        }
      } else {
        logger.error('Unexpected health_check response:', response);
        reject();
      }
    } catch (e) {
      logger.error('Failed fetching health_check:', e);
      reject();
    }
  }));
});

(async () => {
  let errored = false;

  // Force exit as sometimes there is a hanging thread
  await Promise.allSettled(requests).then((results) => {
    results.forEach(result => {
      if (result.status === 'rejected') {
        errored = true;
      }
    });
  });

  process.exit(errored ? 1 : 0);
})();

