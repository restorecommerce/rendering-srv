'use strict';

import Cluster from '@restorecommerce/cluster-service';
import { createServiceConfig } from '@restorecommerce/service-config';

const cfg = createServiceConfig(process.cwd());
const service = new Cluster(cfg);
service.run('./lib/service.js');
