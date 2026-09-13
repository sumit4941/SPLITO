import type { Buffer } from 'node:buffer';

export type MediaKind = 'USER_AVATAR' | 'GROUP_IMAGE';

export interface RawImageUpload {
  readonly bytes: Buffer;
  readonly declaredMediaType: string;
}

export interface ProcessedImage {
  readonly bytes: Buffer;
  readonly mediaType: 'image/webp';
  readonly byteSize: number;
  readonly sha256Hash: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface MediaObject {
  readonly id: string;
  readonly storageKey: string;
  readonly mediaType: 'image/webp';
  readonly byteSize: number;
  readonly sha256Hash: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface MediaMutationResult {
  readonly url: string;
  readonly version: string;
}

export interface MediaDownload {
  readonly bytes: Buffer;
  readonly mediaType: 'image/webp';
  readonly byteSize: number;
  readonly etag: string;
}

export function participantAvatarUrl(participantId: string, mediaId: string): string {
  return `/api/v1/participants/${encodeURIComponent(participantId)}/avatar?v=${encodeURIComponent(mediaId)}`;
}

export function groupImageUrl(groupId: string, mediaId: string): string {
  return `/api/v1/groups/${encodeURIComponent(groupId)}/image?v=${encodeURIComponent(mediaId)}`;
}
