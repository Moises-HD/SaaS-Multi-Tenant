import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';

@Global()
@Module({
  imports: [
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'single',                               
        url: config.get<string>('REDIS_URL')!,        
      }),
    }),
  ],
  exports: [RedisModule],
})
export class RedisIoModule {}   
