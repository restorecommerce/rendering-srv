
import { createServiceConfig, type ServiceConfig } from '@restorecommerce/service-config';
import { createLogger, type Logger } from '@restorecommerce/logger';
import { RenderingService } from './service.js';

export class Worker {
  public service: RenderingService;
  constructor(
    protected cfg?: ServiceConfig,
    protected logger?: Logger,
  ) { }
  
  /**
   * starting/stopping the actual server
   */
  async start(): Promise<any> {
    this.cfg ??= createServiceConfig(process.cwd());
    const loggerCfg = this.cfg?.get('logger');
    this.logger ??= createLogger(loggerCfg);

    this.service = new RenderingService(this.cfg, this.logger);
    await this.service.start();
    return this.service;
  }

  async stop(): Promise<any> {
    await this.service?.stop();
  }
}