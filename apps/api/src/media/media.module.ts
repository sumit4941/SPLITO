import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ImageProcessor } from './image.processor.js';
import { MediaController } from './media.controller.js';
import { MediaRepository } from './media.repository.js';
import { MediaService } from './media.service.js';
import { PrivateMediaStorage } from './private-media.storage.js';

@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [ImageProcessor, MediaRepository, MediaService, PrivateMediaStorage],
})
export class MediaModule {}
