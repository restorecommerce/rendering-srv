const { Events } = require('@restorecommerce/kafka-client');
const { createLogger } = require('@restorecommerce/logger');
const { createServiceConfig } = require('@restorecommerce/service-config');

/*
* This script is used to create kafka topics before running the tests.
*/
async function createTopics() {
  const cfg = createServiceConfig(process.cwd());
  const logger = createLogger(cfg.get('logger'));
  const events = new Events(cfg.get('events:kafka'), logger);
  await events.start();

  process.argv.forEach((value, index, array) => {
    if (index >= 2) {
      events.topic(value);
    }
  });

  // Give a delay of 3 seconds and exit the process
  // this delay is for the creation of topic via zookeeper
  setTimeout(() => {
    console.log('Exiting after topic creation');
    process.exit();
  }, 3000);
}

createTopics().catch((err) => {
  console.log(err);
});

