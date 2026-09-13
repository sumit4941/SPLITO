import { Inject, Injectable } from '@nestjs/common';
import type { Environment } from '@splito/config';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/app-config.js';

export type SmsPurpose = 'mobile_otp' | 'group_invitation';

export interface SmsMessage {
  readonly purpose: SmsPurpose;
  readonly mobileNumber: string;
  readonly body: string;
}

export interface SmsProviderDelivery {
  readonly mode: 'twilio';
  readonly providerMessageId: string;
  readonly providerStatus: string;
}

interface TwilioConfiguration {
  readonly accountSid: string;
  readonly apiKeySid: string;
  readonly apiKeySecret: string;
  readonly from?: string;
  readonly messagingServiceSid?: string;
}

const TWILIO_MESSAGE_SID = /^SM[0-9a-fA-F]{32}$/u;

@Injectable()
export class SmsDeliveryService {
  constructor(@Inject(APP_CONFIG) private readonly config: Environment) {}

  assertAvailable(purpose: SmsPurpose): void {
    if (!this.twilioConfiguration()) throw this.unavailable(purpose);
  }

  async deliver(message: SmsMessage): Promise<SmsProviderDelivery> {
    const twilio = this.twilioConfiguration();
    if (!twilio) throw this.unavailable(message.purpose);

    const fields = new URLSearchParams({
      To: message.mobileNumber,
      Body: message.body,
      ...(twilio.from ? { From: twilio.from } : {}),
      ...(twilio.messagingServiceSid ? { MessagingServiceSid: twilio.messagingServiceSid } : {}),
    });

    let response: Response;
    try {
      response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${twilio.apiKeySid}:${twilio.apiKeySecret}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: fields.toString(),
          signal: AbortSignal.timeout(this.config.SMS_REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw this.deliveryFailure(message.purpose);
    }

    if (!response.ok) throw this.deliveryFailure(message.purpose);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw this.deliveryFailure(message.purpose);
    }

    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('sid' in payload) ||
      typeof payload.sid !== 'string' ||
      !TWILIO_MESSAGE_SID.test(payload.sid) ||
      !('status' in payload) ||
      typeof payload.status !== 'string' ||
      payload.status.length === 0 ||
      payload.status.length > 64
    ) {
      throw this.deliveryFailure(message.purpose);
    }

    return {
      mode: 'twilio',
      providerMessageId: payload.sid,
      providerStatus: payload.status,
    };
  }

  private twilioConfiguration(): TwilioConfiguration | undefined {
    if (
      this.config.SMS_PROVIDER !== 'twilio' ||
      !this.config.TWILIO_ACCOUNT_SID ||
      !this.config.TWILIO_API_KEY_SID ||
      !this.config.TWILIO_API_KEY_SECRET ||
      Boolean(this.config.TWILIO_FROM_E164) === Boolean(this.config.TWILIO_MESSAGING_SERVICE_SID)
    ) {
      return undefined;
    }

    return {
      accountSid: this.config.TWILIO_ACCOUNT_SID,
      apiKeySid: this.config.TWILIO_API_KEY_SID,
      apiKeySecret: this.config.TWILIO_API_KEY_SECRET,
      ...(this.config.TWILIO_FROM_E164 ? { from: this.config.TWILIO_FROM_E164 } : {}),
      ...(this.config.TWILIO_MESSAGING_SERVICE_SID
        ? { messagingServiceSid: this.config.TWILIO_MESSAGING_SERVICE_SID }
        : {}),
    };
  }

  private unavailable(purpose: SmsPurpose): ApiError {
    return purpose === 'mobile_otp'
      ? new ApiError(503, 'OTP_DELIVERY_NOT_CONFIGURED', 'Mobile OTP delivery is unavailable.')
      : new ApiError(
          503,
          'INVITATION_SMS_NOT_CONFIGURED',
          'Group invitation delivery is unavailable.',
        );
  }

  private deliveryFailure(purpose: SmsPurpose): ApiError {
    return purpose === 'mobile_otp'
      ? new ApiError(
          502,
          'OTP_DELIVERY_FAILED',
          'The verification code could not be delivered. Try again.',
        )
      : new ApiError(
          502,
          'INVITATION_SMS_DELIVERY_FAILED',
          'The invitation was saved, but the text message could not be delivered. Try again.',
        );
  }
}
