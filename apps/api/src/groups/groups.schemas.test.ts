import { describe, expect, it } from 'vitest';
import { addGroupMemberSchema, groupInvitationTokenSchema } from './groups.schemas.js';

describe('group member and invitation request schemas', () => {
  it('normalizes an Indian local mobile number to its canonical account identifier', () => {
    expect(addGroupMemberSchema.parse({ mobileNumber: '9876543210' })).toEqual({
      mobileNumber: '+919876543210',
    });
  });

  it('rejects malformed mobile numbers and unknown request fields', () => {
    expect(addGroupMemberSchema.safeParse({ mobileNumber: '123' }).success).toBe(false);
    expect(
      addGroupMemberSchema.safeParse({ mobileNumber: '+14155550123', role: 'OWNER' }).success,
    ).toBe(false);
  });

  it('accepts only an exact opaque base64url invitation token', () => {
    expect(groupInvitationTokenSchema.safeParse({ token: `${'a'.repeat(42)}_` }).success).toBe(
      true,
    );
    expect(groupInvitationTokenSchema.safeParse({ token: 'a'.repeat(42) }).success).toBe(false);
    expect(groupInvitationTokenSchema.safeParse({ token: `${'a'.repeat(42)}=` }).success).toBe(
      false,
    );
    expect(
      groupInvitationTokenSchema.safeParse({ token: 'a'.repeat(43), mobileNumber: '+14155550123' })
        .success,
    ).toBe(false);
  });
});
