import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnvironment } from '@splito/config';
import { SmsDeliveryService } from '../sms/sms-delivery.service.js';
import { InvitationSmsService, type InvitationSmsInput } from './invitation-sms.service.js';

const input: InvitationSmsInput = {
  invitationId: '11111111-1111-4111-8111-111111111111',
  mobileNumber: '+14155550123',
  groupName: 'Goa trip',
  inviterDisplayName: 'Alex',
  token: 'a'.repeat(43),
};

const twilioSettings = {
  NODE_ENV: 'test',
  WEB_ORIGIN: 'https://app.splito.example',
  SMS_PROVIDER: 'twilio',
  SMS_REQUEST_TIMEOUT_MS: '1500',
  TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`,
  TWILIO_API_KEY_SID: `SK${'2'.repeat(32)}`,
  TWILIO_API_KEY_SECRET: 'twilio-key-secret-value',
  TWILIO_MESSAGING_SERVICE_SID: `MG${'3'.repeat(32)}`,
} as const;

function createService(source: NodeJS.ProcessEnv): InvitationSmsService {
  const config = loadEnvironment(source);
  return new InvitationSmsService(config, new SmsDeliveryService(config));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('group invitation SMS delivery', () => {
  it('captures a deterministic development message without calling a provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = createService({
      NODE_ENV: 'development',
      WEB_ORIGIN: 'http://localhost:5173/',
    });

    await expect(service.deliver(input)).resolves.toEqual({
      mode: 'development_capture',
      inviteUrl: `http://localhost:5173/join#invite=${input.token}`,
    });
    expect(service.developmentCapture(input.invitationId)).toMatchObject({
      invitationId: input.invitationId,
      mobileNumber: input.mobileNumber,
      message: expect.stringContaining(`/join#invite=${input.token}`),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed outside development when the provider is disabled', async () => {
    const service = createService({ NODE_ENV: 'test' });

    expect(() => service.assertAvailable()).toThrowError(
      expect.objectContaining({ code: 'INVITATION_SMS_NOT_CONFIGURED', status: 503 }),
    );
    await expect(service.deliver(input)).rejects.toMatchObject({
      code: 'INVITATION_SMS_NOT_CONFIGURED',
      status: 503,
    });
  });

  it('posts a form-encoded message to the fixed Twilio endpoint with API-key auth', async () => {
    const messageSid = `SM${'4'.repeat(32)}`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sid: messageSid, status: 'queued' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = createService(twilioSettings);

    await expect(service.deliver(input)).resolves.toEqual({
      mode: 'twilio',
      providerMessageId: messageSid,
      providerStatus: 'queued',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSettings.TWILIO_ACCOUNT_SID}/Messages.json`,
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      authorization: `Basic ${Buffer.from(`${twilioSettings.TWILIO_API_KEY_SID}:${twilioSettings.TWILIO_API_KEY_SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const fields = new URLSearchParams(String(options.body));
    expect(Object.fromEntries(fields)).toEqual({
      To: input.mobileNumber,
      Body: expect.stringContaining(`/join#invite=${input.token}`),
      MessagingServiceSid: twilioSettings.TWILIO_MESSAGING_SERVICE_SID,
    });
    expect(fields.has('From')).toBe(false);
  });

  it('returns a generic failure without exposing Twilio response content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: `provider rejected ${input.token}` }), {
        status: 400,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = createService(twilioSettings);

    const rejection = service.deliver(input);
    await expect(rejection).rejects.toMatchObject({
      code: 'INVITATION_SMS_DELIVERY_FAILED',
      status: 502,
    });
    await expect(rejection).rejects.not.toThrow(input.token);
  });
});
