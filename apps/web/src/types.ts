export type CurrencyCode = string;

export interface MoneyValue {
  amountMinor: string;
  currency: CurrencyCode;
}

export interface UserProfile {
  id: string;
  participantId?: string;
  userId?: string;
  displayName: string;
  email?: string;
  mobileNumber?: string;
  avatarUrl?: string;
  locale?: string;
  timezone?: string;
  defaultCurrency?: CurrencyCode;
  theme?: 'light' | 'dark' | 'system';
  reducedMotion?: boolean;
  preferences?: {
    reducedMotion?: boolean;
    emailNotifications?: boolean;
    pushNotifications?: boolean;
    balanceReminders?: boolean;
  };
  capabilities?: string[];
}

export interface Participant {
  id: string;
  displayName: string;
  avatarUrl?: string;
  role?: 'owner' | 'administrator' | 'member' | 'guest';
  status?: 'active' | 'former' | 'invited';
}

export interface GroupInvitationSummary {
  id: string;
  maskedMobileNumber: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

export type AddGroupMemberResult =
  | {
      outcome: 'member_added';
      member: Participant;
    }
  | {
      outcome: 'invitation_sent';
      invitation: GroupInvitationSummary & { status: 'pending' };
      developmentJoinUrl?: string;
    };

export interface GroupInvitationPreview {
  invitationId?: string;
  groupId: string;
  groupName: string;
  inviterDisplayName?: string;
  maskedMobileNumber?: string;
  expiresAt: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  type?: string;
  role?: 'owner' | 'administrator' | 'member';
  defaultCurrency: CurrencyCode;
  memberCount?: number;
  archived?: boolean;
  myBalance?: MoneyValue | MoneyValue[];
  updatedAt?: string;
}

export interface GroupDetail extends GroupSummary {
  members: Participant[];
  pendingInvitations?: GroupInvitationSummary[];
  simplificationEnabled?: boolean;
}

export interface BalanceLine {
  currency: CurrencyCode;
  netAmountMinor: string;
  owedAmountMinor?: string;
  receivableAmountMinor?: string;
  contextId?: string;
  contextName?: string;
}

export interface ExpenseSummary {
  id: string;
  description: string;
  amount: MoneyValue;
  expenseDate: string;
  category?: string;
  groupId?: string;
  groupName?: string;
  createdBy?: Participant;
  canEdit: boolean;
  status?: 'draft' | 'posted' | 'voided' | 'refunded';
  version?: string | number;
  myShare?: MoneyValue;
  notes?: string;
  splitMethod?: 'equal' | 'exact' | 'percentage' | 'shares' | 'adjustments';
  payers?: Array<Participant & { paidAmountMinor: string }>;
  allocations?: Array<
    Participant & { owedAmountMinor: string; netAmountMinor?: string; inputValue?: string }
  >;
  attachments?: Array<{ id: string; fileName: string; mediaType?: string; status?: string }>;
  revisionNumber?: number;
}

export interface SplitPreviewLine {
  participantId: string;
  displayName?: string;
  paidAmountMinor: string;
  owedAmountMinor: string;
  netAmountMinor: string;
}

export interface SplitPreview {
  currency: CurrencyCode;
  totalAmountMinor: string;
  allocations: SplitPreviewLine[];
  explanation?: string;
  algorithmVersion?: string;
}

export interface CategorySpend {
  category: string;
  amountMinor: string;
  currency: CurrencyCode;
  expenseCount?: number;
}

export interface AnalyticsResponse {
  periodLabel?: string;
  categories: CategorySpend[];
  paidAmountMinor?: string;
  owedAmountMinor?: string;
  currency?: CurrencyCode;
  conversionBasis?: string;
}

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description?: string;
  occurredAt: string;
  actorName?: string;
  status?: string;
}

export interface RecurringTemplate {
  id: string;
  description: string;
  amount: MoneyValue;
  frequency: 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'yearly';
  nextOccurrenceAt?: string;
  timezone?: string;
  status: 'active' | 'paused' | 'cancelled' | 'attention';
  groupName?: string;
}

export interface ReceiptRecord {
  id: string;
  fileName: string;
  uploadedAt: string;
  status: 'uploaded' | 'processing' | 'needs_review' | 'confirmed' | 'failed';
  merchant?: string;
  total?: MoneyValue;
  expenseId?: string;
  confidence?: string;
}

export interface SessionRecord {
  id: string;
  deviceName: string;
  location?: string;
  createdAt: string;
  lastSeenAt: string;
  current?: boolean;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface ApiFieldError {
  field: string;
  message: string;
}
