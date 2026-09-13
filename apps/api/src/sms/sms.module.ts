import { Module } from '@nestjs/common';
import { SmsDeliveryService } from './sms-delivery.service.js';

@Module({
  providers: [SmsDeliveryService],
  exports: [SmsDeliveryService],
})
export class SmsModule {}
