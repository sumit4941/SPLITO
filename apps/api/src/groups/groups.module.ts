import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { GroupInvitationsRepository } from './group-invitations.repository.js';
import { GroupInvitationsController, GroupsController } from './groups.controller.js';
import { GroupsRepository } from './groups.repository.js';
import { GroupsService } from './groups.service.js';
import { InvitationSmsService } from './invitation-sms.service.js';

@Module({
  imports: [AuthModule, SmsModule],
  controllers: [GroupsController, GroupInvitationsController],
  providers: [GroupsRepository, GroupInvitationsRepository, GroupsService, InvitationSmsService],
  exports: [GroupsRepository],
})
export class GroupsModule {}
