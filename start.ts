'use strict';

import * as Cluster from '@restorecommerce/cluster-service';
import * as  sconfig from '@restorecommerce/service-config';

const cfg = sconfig(process.cwd());
const service = new Cluster(cfg);
service.run('./service.js');
