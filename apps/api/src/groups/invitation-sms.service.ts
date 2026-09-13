import { Inject, Injectable } from '@nestjs/common';
import type { Environment } from '@splito/config';
import { APP_CONFIG } from '../config/app-config.js';
import { SmsDeliveryService, type SmsProviderDelivery } from '../sms/sms-delivery.service.js';

export interface InvitationSmsInput {
  readonly invitationId: string;
  readonly mobileNumber: string;
  readonly groupName: string;
  readonly inviterDisplayName: string;
  readonly token: string;
}

export type InvitationSmsDelivery =
  | {
      readonly mode: 'development_capture';
      readonly inviteUrl: string;
    }
  | SmsProviderDelivery;

interface DevelopmentCapture {
  readonly invitationId: string;
  readonly mobileNumber: string;
  readonly message: string;
  readonly mode: 'development_capture';
  readonly inviteUrl: string;
}

const MAX_DEVELOPMENT_CAPTURES = 1_000;

@Injectable()
export class InvitationSmsService {
  readonly #captures = new Map<string, DevelopmentCapture>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: Environment,
    private readonly sms: SmsDeliveryService,
  ) {}

  assertAvailable(): void {
    if (this.config.NODE_ENV === 'development') return;
    this.sms.assertAvailable('group_invitation');
  }

  async deliver(input: InvitationSmsInput): Promise<InvitationSmsDelivery> {
    const inviteUrl = `${this.config.WEB_ORIGIN.replace(/\/$/u, '')}/join#invite=${input.token}`;
    const message = `${input.inviterDisplayName} invited you to join ${input.groupName} on SPLITO. Register or sign in to join: ${inviteUrl}`;

    if (this.config.NODE_ENV === 'development') {
      return this.captureDevelopmentMessage(input, inviteUrl, message);
    }

    return this.sms.deliver({
      purpose: 'group_invitation',
      mobileNumber: input.mobileNumber,
      body: message,
    });
  }

  developmentCapture(invitationId: string): DevelopmentCapture | undefined {
    return this.#captures.get(invitationId);
  }

  private captureDevelopmentMessage(
    input: InvitationSmsInput,
    inviteUrl: string,
    message: string,
  ): InvitationSmsDelivery {
    if (this.#captures.size >= MAX_DEVELOPMENT_CAPTURES) {
      const oldest = this.#captures.keys().next().value;
      if (oldest) this.#captures.delete(oldest);
    }
    this.#captures.set(input.invitationId, {
      invitationId: input.invitationId,
      mobileNumber: input.mobileNumber,
      message,
      mode: 'development_capture',
      inviteUrl,
    });
    return { mode: 'development_capture', inviteUrl };
  }
}
