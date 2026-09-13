import { domainAssert } from './errors.js';

export const MAX_ALLOCATION_PARTICIPANTS = 1_000;

export interface OrderedParticipant {
  readonly participantId: string;
  readonly allocationOrder: number;
}

export function compareOrderedParticipants(
  left: OrderedParticipant,
  right: OrderedParticipant,
): number {
  return (
    left.allocationOrder - right.allocationOrder ||
    left.participantId.localeCompare(right.participantId)
  );
}

export function normalizeOrderedParticipants<T extends OrderedParticipant>(
  participants: readonly T[],
): T[] {
  domainAssert(
    participants.length > 0 && participants.length <= MAX_ALLOCATION_PARTICIPANTS,
    'INVALID_PARTICIPANT_COUNT',
    `There must be between 1 and ${MAX_ALLOCATION_PARTICIPANTS} participants.`,
    { count: participants.length },
  );

  const participantIds = new Set<string>();
  const allocationOrders = new Set<number>();
  for (const participant of participants) {
    domainAssert(
      typeof participant.participantId === 'string' &&
        participant.participantId.length > 0 &&
        participant.participantId === participant.participantId.trim(),
      'INVALID_PARTICIPANT_ID',
      'Participant IDs must be nonempty and cannot have surrounding whitespace.',
    );
    domainAssert(
      Number.isSafeInteger(participant.allocationOrder) && participant.allocationOrder >= 0,
      'INVALID_ALLOCATION_ORDER',
      'Allocation order must be a nonnegative safe integer.',
      { participantId: participant.participantId },
    );
    domainAssert(
      !participantIds.has(participant.participantId),
      'DUPLICATE_PARTICIPANT',
      'A participant can appear only once in an allocation.',
      { participantId: participant.participantId },
    );
    domainAssert(
      !allocationOrders.has(participant.allocationOrder),
      'DUPLICATE_ALLOCATION_ORDER',
      'Persisted allocation order values must be unique.',
      { allocationOrder: participant.allocationOrder },
    );
    participantIds.add(participant.participantId);
    allocationOrders.add(participant.allocationOrder);
  }

  return [...participants].sort(compareOrderedParticipants);
}
