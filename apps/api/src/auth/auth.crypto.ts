import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function secretHash(secret: string, value: string): Buffer {
  return createHmac('sha256', secret).update(value, 'utf8').digest();
}

export function hashesEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function generateNumericOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function mobileOtpHash(
  pepper: string,
  challengeId: string,
  mobileNumber: string,
  otp: string,
): Buffer {
  return secretHash(pepper, `splito:mobile-otp:v1:${challengeId}:${mobileNumber}:${otp}`);
}
