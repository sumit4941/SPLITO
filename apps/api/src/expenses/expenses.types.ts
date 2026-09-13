import type {
  AllocatedAmount,
  BilateralObligation,
  JournalPosting,
  SplitMethod,
} from '@splito/domain';
import type { ExpenseMutationInput } from './expenses.schemas.js';

export interface ContextParticipant {
  readonly id: string;
  readonly displayName: string;
  readonly allocationOrder: number;
}

export interface PreparedExpense {
  readonly input: ExpenseMutationInput;
  readonly contextId: string;
  readonly groupName: string;
  readonly participants: readonly ContextParticipant[];
  readonly allocations: readonly AllocatedAmount[];
  readonly postings: readonly JournalPosting[];
  readonly obligations: readonly BilateralObligation[];
  readonly algorithmVersion: string;
  readonly bilateralAlgorithmVersion: string;
  readonly splitMethod: SplitMethod;
}

export interface SplitPreviewLine {
  readonly participantId: string;
  readonly displayName: string;
  readonly paidAmountMinor: string;
  readonly owedAmountMinor: string;
  readonly netAmountMinor: string;
}

export interface SplitPreviewResponse {
  readonly currency: string;
  readonly totalAmountMinor: string;
  readonly allocations: readonly SplitPreviewLine[];
  readonly explanation: string;
  readonly algorithmVersion: string;
}

export interface ExpenseSummaryResponse {
  readonly id: string;
  readonly description: string;
  readonly amount: { readonly amountMinor: string; readonly currency: string };
  readonly expenseDate: string;
  readonly category: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly status: 'draft' | 'posted' | 'voided';
  readonly version: string;
  readonly notes?: string;
  readonly payers: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly paidAmountMinor: string;
  }[];
  readonly allocations: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly owedAmountMinor: string;
    readonly netAmountMinor: string;
  }[];
  readonly revisionNumber: number;
  readonly splitMethod?: string;
  readonly algorithmVersion?: string;
  readonly createdBy: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly canEdit: boolean;
}
