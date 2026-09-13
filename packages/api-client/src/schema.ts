/* This file is generated from docs/openapi.json. Do not edit by hand. */
export interface paths {
  '/api/v1/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Create an opaque server-side session */
    post: operations['AuthController_login'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['AuthController_logout'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/mobile/request-otp': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Request a single-use mobile sign-in code
     * @description Enumeration-safe OTP request. Development returns the code explicitly; production fails closed until an external SMS adapter is configured.
     */
    post: operations['AuthController_requestMobileOtp'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/mobile/verify-otp': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Verify a mobile code and replace any prior active session */
    post: operations['AuthController_verifyMobileOtp'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/register': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Register a pending account */
    post: operations['AuthController_register'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/session': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['AuthController_session'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/verify-email': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Consume a single-use email verification token */
    post: operations['AuthController_verifyEmail'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/balances': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List the current participant's nonzero balances by context and currency */
    get: operations['BalancesController_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/expenses': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Post an expense, journal, projections, outbox, and idempotency outcome atomically */
    post: operations['ExpensesController_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/expenses/{expenseId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get an authorized expense with its current revision, payers, and shares */
    get: operations['ExpensesController_detail'];
    /** Replace an expense by appending a revision and reversing its prior journal */
    put: operations['ExpensesController_update'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/expenses/split-preview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Preview an authoritative deterministic split without posting it */
    post: operations['ExpensesController_preview'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/group-invitations/accept': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Accept a phone-bound invitation and join its active group */
    post: operations['GroupInvitationsController_accept'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/group-invitations/preview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Preview a phone-bound group invitation after sign-in */
    post: operations['GroupInvitationsController_preview'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/groups': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List groups visible to the current member */
    get: operations['GroupsController_list'];
    put?: never;
    /** Create a group and its owner membership atomically */
    post: operations['GroupsController_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/groups/{groupId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get a group and its membership roster */
    get: operations['GroupsController_detail'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/groups/{groupId}/balances': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get the current participant's balances in one group */
    get: operations['GroupBalancesController_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/groups/{groupId}/expenses': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List posted group expenses with stable cursor pagination */
    get: operations['GroupExpensesController_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/groups/{groupId}/image': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read an authorized versioned group image */
    get: operations['MediaController_groupImage'];
    /** Upload and replace a group image as owner or administrator */
    put: operations['MediaController_uploadGroupImage'];
    post?: never;
    /** Delete a group image as owner or administrator */
    delete: operations['MediaController_deleteGroupImage'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/groups/{groupId}/members': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Add a registered mobile account or send a secure group invitation */
    post: operations['GroupsController_addMember'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/health/live': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Process liveness */
    get: operations['HealthController_live'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/health/ready': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Oracle-backed readiness */
    get: operations['HealthController_ready'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/me': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get the authenticated user */
    get: operations['MeController_me'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/me/avatar': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    /** Upload and replace the authenticated user avatar */
    put: operations['MediaController_uploadAvatar'];
    post?: never;
    /** Delete the authenticated user avatar */
    delete: operations['MediaController_deleteAvatar'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/participants/{participantId}/avatar': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read an authorized versioned participant avatar */
    get: operations['MediaController_participantAvatar'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/settlements': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Record a version-checked manual payment assertion atomically */
    post: operations['SettlementsController_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/settlements/preview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Preview a manual settlement against current bilateral debt */
    post: operations['SettlementsController_preview'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    AddGroupMemberRequest: {
      mobileNumber: string;
    };
    BalanceLine: {
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      contextId: string;
      contextName: string;
      /** @example INR */
      currency: string;
      /**
       * @description Signed integer minor units serialized as a decimal string.
       * @example -1250
       */
      netAmountMinor: string;
      /**
       * @description Integer minor units serialized as a decimal string.
       * @example 1250
       */
      owedAmountMinor: string;
      /**
       * @description Integer minor units serialized as a decimal string.
       * @example 1250
       */
      receivableAmountMinor: string;
      version: string;
    };
    BalanceListEnvelope: {
      data: components['schemas']['BalanceLine'][];
    };
    CreateGroupRequest: {
      /** @default INR */
      defaultCurrency?: string;
      description?: string;
      name: string;
      /** @default false */
      simplificationEnabled?: boolean;
      /**
       * @default other
       * @enum {string}
       */
      type?: 'home' | 'trip' | 'couple' | 'family' | 'project' | 'other';
    };
    CreateSettlementRequest: {
      amountMinor: string;
      context: {
        id: string;
        /** @constant */
        type: 'group';
      };
      currency: string;
      /** @enum {string} */
      method: 'cash' | 'bank' | 'upi' | 'card' | 'other';
      note?: string;
      /** @default false */
      overpaymentConfirmed?: boolean;
      previewVersion: string;
      recipientId: string;
      senderId: string;
      settlementDate: string;
    };
    ErrorEnvelope: {
      error: {
        code: string;
        fieldErrors?: {
          field: string;
          message: string;
        }[];
        message: string;
        /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
        requestId: string;
      };
    };
    Expense: {
      algorithmVersion?: string;
      allocations: components['schemas']['ExpenseAllocation'][];
      amount: {
        /**
         * @description Integer minor units serialized as a decimal string.
         * @example 1250
         */
        amountMinor: string;
        /** @example INR */
        currency: string;
      };
      /** @description True only for the active member who originally created this posted expense. */
      canEdit: boolean;
      category: string;
      createdBy: {
        displayName: string;
        /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
        id: string;
      };
      description: string;
      /**
       * Format: date
       * @example 2026-09-12
       */
      expenseDate: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      groupId: string;
      groupName: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      id: string;
      notes?: string;
      payers: components['schemas']['ExpensePayer'][];
      revisionNumber: number;
      /** @enum {string} */
      splitMethod?: 'equal' | 'exact' | 'percentage' | 'shares' | 'adjustments';
      /** @enum {string} */
      status: 'draft' | 'posted' | 'voided';
      version: string;
    };
    ExpenseAllocation: {
      displayName: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      id: string;
      inputValue?: string;
      /**
       * @description Signed integer minor units serialized as a decimal string.
       * @example -1250
       */
      netAmountMinor: string;
      /**
       * @description Integer minor units serialized as a decimal string.
       * @example 1250
       */
      owedAmountMinor: string;
    };
    ExpenseEnvelope: {
      data: components['schemas']['Expense'];
    };
    ExpenseMutationRequest:
      | {
          amountMinor: string;
          beneficiaries: {
            participantId: string;
          }[];
          category: string;
          currency: string;
          description: string;
          expenseDate: string;
          groupId: string;
          notes?: string;
          originalSplitInputs?: (
            | {
                participantId: string;
              }
            | {
                amountMinor: string;
                participantId: string;
              }
            | {
                participantId: string;
                percentage: string;
              }
            | {
                participantId: string;
                shares: string;
              }
            | {
                adjustmentMinor: string;
                participantId: string;
              }
          )[];
          payers: {
            paidAmountMinor: string;
            participantId: string;
          }[];
          /** @constant */
          splitMethod: 'equal';
        }
      | {
          amountMinor: string;
          beneficiaries: {
            amountMinor: string;
            participantId: string;
          }[];
          category: string;
          currency: string;
          description: string;
          expenseDate: string;
          groupId: string;
          notes?: string;
          originalSplitInputs?: (
            | {
                participantId: string;
              }
            | {
                amountMinor: string;
                participantId: string;
              }
            | {
                participantId: string;
                percentage: string;
              }
            | {
                participantId: string;
                shares: string;
              }
            | {
                adjustmentMinor: string;
                participantId: string;
              }
          )[];
          payers: {
            paidAmountMinor: string;
            participantId: string;
          }[];
          /** @constant */
          splitMethod: 'exact';
        }
      | {
          amountMinor: string;
          beneficiaries: {
            participantId: string;
            percentage: string;
          }[];
          category: string;
          currency: string;
          description: string;
          expenseDate: string;
          groupId: string;
          notes?: string;
          originalSplitInputs?: (
            | {
                participantId: string;
              }
            | {
                amountMinor: string;
                participantId: string;
              }
            | {
                participantId: string;
                percentage: string;
              }
            | {
                participantId: string;
                shares: string;
              }
            | {
                adjustmentMinor: string;
                participantId: string;
              }
          )[];
          payers: {
            paidAmountMinor: string;
            participantId: string;
          }[];
          /** @constant */
          splitMethod: 'percentage';
        }
      | {
          amountMinor: string;
          beneficiaries: {
            participantId: string;
            shares: string;
          }[];
          category: string;
          currency: string;
          description: string;
          expenseDate: string;
          groupId: string;
          notes?: string;
          originalSplitInputs?: (
            | {
                participantId: string;
              }
            | {
                amountMinor: string;
                participantId: string;
              }
            | {
                participantId: string;
                percentage: string;
              }
            | {
                participantId: string;
                shares: string;
              }
            | {
                adjustmentMinor: string;
                participantId: string;
              }
          )[];
          payers: {
            paidAmountMinor: string;
            participantId: string;
          }[];
          /** @constant */
          splitMethod: 'shares';
        }
      | {
          amountMinor: string;
          beneficiaries: {
            adjustmentMinor: string;
            participantId: string;
          }[];
          category: string;
          currency: string;
          description: string;
          expenseDate: string;
          groupId: string;
          notes?: string;
          originalSplitInputs?: (
            | {
                participantId: string;
              }
            | {
                amountMinor: string;
                participantId: string;
              }
            | {
                participantId: string;
                percentage: string;
              }
            | {
                participantId: string;
                shares: string;
              }
            | {
                adjustmentMinor: string;
                participantId: string;
              }
          )[];
          payers: {
            paidAmountMinor: string;
            participantId: string;
          }[];
          /** @constant */
          splitMethod: 'adjustments';
        };
    ExpensePage: {
      items: components['schemas']['Expense'][];
      nextCursor?: string;
    };
    ExpensePageEnvelope: {
      data: components['schemas']['ExpensePage'];
    };
    ExpensePayer: {
      displayName: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      id: string;
      /**
       * @description Integer minor units serialized as a decimal string.
       * @example 1250
       */
      paidAmountMinor: string;
    };
    Group: {
      archived: boolean;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      contextId: string;
      /** Format: date-time */
      createdAt: string;
      /** @example INR */
      defaultCurrency: string;
      description?: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      id: string;
      /** @example /api/v1/groups/id/image?v=media-id */
      imageUrl?: string;
      memberCount: number;
      name: string;
      /** @enum {string} */
      role: 'owner' | 'administrator' | 'member';
      simplificationEnabled: boolean;
      /** @enum {string} */
      type: 'home' | 'trip' | 'couple' | 'family' | 'project' | 'other';
      /** Format: date-time */
      updatedAt: string;
      version: string;
    };
    GroupDetail: components['schemas']['Group'] & {
      members: components['schemas']['GroupMember'][];
      /** @description Pending mobile invitations, visible only to group owners and administrators. */
      pendingInvitations: components['schemas']['PendingGroupInvitation'][];
    };
    GroupDetailEnvelope: {
      data: components['schemas']['GroupDetail'];
    };
    GroupEnvelope: {
      data: components['schemas']['Group'];
    };
    GroupInvitationAcceptance: {
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      groupId: string;
      groupName: string;
      member: components['schemas']['GroupMember'];
      /** @enum {string} */
      outcome: 'joined';
    };
    GroupInvitationAcceptanceEnvelope: {
      data: components['schemas']['GroupInvitationAcceptance'];
    };
    GroupInvitationPreview: {
      /** Format: date-time */
      expiresAt: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      groupId: string;
      groupName: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      invitationId: string;
      inviterDisplayName: string;
    };
    GroupInvitationPreviewEnvelope: {
      data: components['schemas']['GroupInvitationPreview'];
    };
    GroupInvitationSentEnvelope: {
      data: components['schemas']['GroupInvitationSentResult'];
    };
    GroupInvitationSentResult: {
      /**
       * Format: uri
       * @description Development-only captured join URL; never returned in production.
       */
      developmentJoinUrl?: string;
      invitation: components['schemas']['PendingGroupInvitation'];
      /** @enum {string} */
      outcome: 'invitation_sent';
    };
    GroupInvitationTokenRequest: {
      token: string;
    };
    GroupListEnvelope: {
      data: components['schemas']['Group'][];
    };
    GroupMember: {
      allocationOrder: number;
      /** @example /api/v1/participants/id/avatar?v=media-id */
      avatarUrl?: string;
      displayName: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      id: string;
      /** @enum {string} */
      kind: 'USER' | 'GUEST';
      /** @enum {string} */
      role: 'owner' | 'administrator' | 'member' | 'guest';
      /** @enum {string} */
      status: 'active' | 'former';
    };
    LiveStatus: {
      /** @enum {string} */
      status: 'ok';
    };
    LoginRequest: {
      deviceName?: string;
      /** Format: email */
      email: string;
      password: string;
    };
    MediaMutation: {
      /** @description Cookie-authenticated, versioned, same-origin image URL. */
      url: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      version: string;
    };
    MediaMutationEnvelope: {
      data: components['schemas']['MediaMutation'];
    };
    MobileOtpChallenge: {
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      challengeId: string;
      /** @description Present only in development; never persisted or emitted in production. */
      developmentOtp?: string;
      /** @enum {integer} */
      expiresInSeconds: 300;
      /** @example +********3210 */
      maskedMobileNumber: string;
      /** @enum {integer} */
      resendAfterSeconds: 60;
    };
    MobileOtpChallengeEnvelope: {
      data: components['schemas']['MobileOtpChallenge'];
    };
    MobileOtpVerification: {
      /** @description True only when verification provisioned the account in this transaction. */
      isNewAccount: boolean;
      user: components['schemas']['User'];
    };
    MobileOtpVerificationEnvelope: {
      data: components['schemas']['MobileOtpVerification'];
    };
    PendingGroupInvitation: {
      /** Format: date-time */
      expiresAt: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      id: string;
      /** @example +********3210 */
      maskedMobileNumber: string;
      /** @enum {string} */
      status: 'pending';
    };
    ReadyStatus: {
      database: {
        currentSchema: string;
        databaseVersion: string;
      };
      /** @enum {string} */
      status: 'ok';
    };
    RegisteredGroupMemberEnvelope: {
      data: components['schemas']['RegisteredGroupMemberResult'];
    };
    RegisteredGroupMemberResult: {
      member: components['schemas']['GroupMember'];
      /** @enum {string} */
      outcome: 'member_added';
    };
    RegisterRequest: {
      /** @default INR */
      defaultCurrency?: string;
      displayName: string;
      /** Format: email */
      email: string;
      /** @default en-IN */
      locale?: string;
      password: string;
      /** @default Asia/Kolkata */
      timezone?: string;
    };
    RegistrationEnvelope: {
      data: components['schemas']['RegistrationResult'];
    };
    RegistrationResult: {
      /** @description Present only in development; never emitted in production. */
      developmentVerificationToken?: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      userId?: string;
      /** @enum {boolean} */
      verificationRequired: true;
    };
    RequestMobileOtpRequest: {
      mobileNumber: string;
      /** @constant */
      purpose?: 'login';
    };
    SettlementCreated: {
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      id: string;
      /** @enum {string} */
      status: 'posted';
      /** @enum {boolean} */
      userAssertion: true;
      version: string;
    };
    SettlementCreatedEnvelope: {
      data: components['schemas']['SettlementCreated'];
    };
    SettlementPreview: {
      explanation: string;
      /**
       * @description Integer minor units serialized as a decimal string.
       * @example 1250
       */
      outstandingAmountMinor: string;
      overpayment: boolean;
      previewVersion: string;
    };
    SettlementPreviewEnvelope: {
      data: components['schemas']['SettlementPreview'];
    };
    SettlementPreviewRequest: {
      amountMinor: string;
      context: {
        id: string;
        /** @constant */
        type: 'group';
      };
      currency: string;
      /** @enum {string} */
      method: 'cash' | 'bank' | 'upi' | 'card' | 'other';
      note?: string;
      recipientId: string;
      senderId: string;
      settlementDate: string;
    };
    SplitPreview: {
      algorithmVersion: string;
      allocations: components['schemas']['SplitPreviewLine'][];
      /** @example INR */
      currency: string;
      explanation: string;
      /**
       * @description Integer minor units serialized as a decimal string.
       * @example 1250
       */
      totalAmountMinor: string;
    };
    SplitPreviewEnvelope: {
      data: components['schemas']['SplitPreview'];
    };
    SplitPreviewLine: {
      displayName: string;
      /**
       * @description Signed integer minor units serialized as a decimal string.
       * @example -1250
       */
      netAmountMinor: string;
      /**
       * @description Integer minor units serialized as a decimal string.
       * @example 1250
       */
      owedAmountMinor: string;
      /**
       * @description Integer minor units serialized as a decimal string.
       * @example 1250
       */
      paidAmountMinor: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      participantId: string;
    };
    User: {
      /** @example /api/v1/participants/id/avatar?v=media-id */
      avatarUrl?: string;
      /** @example INR */
      defaultCurrency: string;
      displayName: string;
      /** Format: email */
      email?: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      id: string;
      locale: string;
      /** @description Verified mobile identity in canonical E.164 form. */
      mobileNumber?: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      participantId: string;
      reducedMotion: boolean;
      /** @enum {string} */
      theme: 'light' | 'dark' | 'system';
      timezone: string;
      /** @example 2f40d889-89f7-4fcb-99f0-8702f88d0c77 */
      userId: string;
      version: string;
    };
    UserEnvelope: {
      data: components['schemas']['User'];
    };
    VerifyEmailRequest: {
      token: string;
    };
    VerifyMobileOtpRequest: {
      /** Format: uuid */
      challengeId: string;
      deviceName?: string;
      /** @default en-IN */
      locale?: string;
      mobileNumber: string;
      otp: string;
      /** @default Asia/Kolkata */
      timezone?: string;
    };
  };
  responses: {
    /** @description The external SMS provider did not accept the invitation message. */
    BadGateway: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description Malformed input or identifier. */
    BadRequest: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description The resource version, idempotency body, or financial state conflicts. */
    Conflict: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description The authenticated identity is not authorized. */
    Forbidden: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description An unexpected server error occurred. */
    InternalError: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description The resource does not exist or is not visible to this identity. */
    NotFound: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description The uploaded file or multipart request exceeds its limit. */
    PayloadTooLarge: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description The supplied resource version is stale. */
    PreconditionFailed: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description A required optimistic-concurrency header is missing. */
    PreconditionRequired: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description The request rate limit was exceeded. */
    RateLimited: {
      headers: {
        /** @description Minimum seconds before retrying; 60 for cooldown or up to 900 for quota. */
        'Retry-After'?: number;
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description A required external delivery adapter is unavailable. */
    ServiceUnavailable: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description A valid session is required. */
    Unauthorized: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description The financial-domain invariant was not satisfied. */
    UnprocessableEntity: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description The upload is not an accepted image or multipart body. */
    UnsupportedMediaType: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
  };
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type SchemaAddGroupMemberRequest = components['schemas']['AddGroupMemberRequest'];
export type SchemaBalanceLine = components['schemas']['BalanceLine'];
export type SchemaBalanceListEnvelope = components['schemas']['BalanceListEnvelope'];
export type SchemaCreateGroupRequest = components['schemas']['CreateGroupRequest'];
export type SchemaCreateSettlementRequest = components['schemas']['CreateSettlementRequest'];
export type SchemaErrorEnvelope = components['schemas']['ErrorEnvelope'];
export type SchemaExpense = components['schemas']['Expense'];
export type SchemaExpenseAllocation = components['schemas']['ExpenseAllocation'];
export type SchemaExpenseEnvelope = components['schemas']['ExpenseEnvelope'];
export type SchemaExpenseMutationRequest = components['schemas']['ExpenseMutationRequest'];
export type SchemaExpensePage = components['schemas']['ExpensePage'];
export type SchemaExpensePageEnvelope = components['schemas']['ExpensePageEnvelope'];
export type SchemaExpensePayer = components['schemas']['ExpensePayer'];
export type SchemaGroup = components['schemas']['Group'];
export type SchemaGroupDetail = components['schemas']['GroupDetail'];
export type SchemaGroupDetailEnvelope = components['schemas']['GroupDetailEnvelope'];
export type SchemaGroupEnvelope = components['schemas']['GroupEnvelope'];
export type SchemaGroupInvitationAcceptance = components['schemas']['GroupInvitationAcceptance'];
export type SchemaGroupInvitationAcceptanceEnvelope =
  components['schemas']['GroupInvitationAcceptanceEnvelope'];
export type SchemaGroupInvitationPreview = components['schemas']['GroupInvitationPreview'];
export type SchemaGroupInvitationPreviewEnvelope =
  components['schemas']['GroupInvitationPreviewEnvelope'];
export type SchemaGroupInvitationSentEnvelope =
  components['schemas']['GroupInvitationSentEnvelope'];
export type SchemaGroupInvitationSentResult = components['schemas']['GroupInvitationSentResult'];
export type SchemaGroupInvitationTokenRequest =
  components['schemas']['GroupInvitationTokenRequest'];
export type SchemaGroupListEnvelope = components['schemas']['GroupListEnvelope'];
export type SchemaGroupMember = components['schemas']['GroupMember'];
export type SchemaLiveStatus = components['schemas']['LiveStatus'];
export type SchemaLoginRequest = components['schemas']['LoginRequest'];
export type SchemaMediaMutation = components['schemas']['MediaMutation'];
export type SchemaMediaMutationEnvelope = components['schemas']['MediaMutationEnvelope'];
export type SchemaMobileOtpChallenge = components['schemas']['MobileOtpChallenge'];
export type SchemaMobileOtpChallengeEnvelope = components['schemas']['MobileOtpChallengeEnvelope'];
export type SchemaMobileOtpVerification = components['schemas']['MobileOtpVerification'];
export type SchemaMobileOtpVerificationEnvelope =
  components['schemas']['MobileOtpVerificationEnvelope'];
export type SchemaPendingGroupInvitation = components['schemas']['PendingGroupInvitation'];
export type SchemaReadyStatus = components['schemas']['ReadyStatus'];
export type SchemaRegisteredGroupMemberEnvelope =
  components['schemas']['RegisteredGroupMemberEnvelope'];
export type SchemaRegisteredGroupMemberResult =
  components['schemas']['RegisteredGroupMemberResult'];
export type SchemaRegisterRequest = components['schemas']['RegisterRequest'];
export type SchemaRegistrationEnvelope = components['schemas']['RegistrationEnvelope'];
export type SchemaRegistrationResult = components['schemas']['RegistrationResult'];
export type SchemaRequestMobileOtpRequest = components['schemas']['RequestMobileOtpRequest'];
export type SchemaSettlementCreated = components['schemas']['SettlementCreated'];
export type SchemaSettlementCreatedEnvelope = components['schemas']['SettlementCreatedEnvelope'];
export type SchemaSettlementPreview = components['schemas']['SettlementPreview'];
export type SchemaSettlementPreviewEnvelope = components['schemas']['SettlementPreviewEnvelope'];
export type SchemaSettlementPreviewRequest = components['schemas']['SettlementPreviewRequest'];
export type SchemaSplitPreview = components['schemas']['SplitPreview'];
export type SchemaSplitPreviewEnvelope = components['schemas']['SplitPreviewEnvelope'];
export type SchemaSplitPreviewLine = components['schemas']['SplitPreviewLine'];
export type SchemaUser = components['schemas']['User'];
export type SchemaUserEnvelope = components['schemas']['UserEnvelope'];
export type SchemaVerifyEmailRequest = components['schemas']['VerifyEmailRequest'];
export type SchemaVerifyMobileOtpRequest = components['schemas']['VerifyMobileOtpRequest'];
export type ResponseBadGateway = components['responses']['BadGateway'];
export type ResponseBadRequest = components['responses']['BadRequest'];
export type ResponseConflict = components['responses']['Conflict'];
export type ResponseForbidden = components['responses']['Forbidden'];
export type ResponseInternalError = components['responses']['InternalError'];
export type ResponseNotFound = components['responses']['NotFound'];
export type ResponsePayloadTooLarge = components['responses']['PayloadTooLarge'];
export type ResponsePreconditionFailed = components['responses']['PreconditionFailed'];
export type ResponsePreconditionRequired = components['responses']['PreconditionRequired'];
export type ResponseRateLimited = components['responses']['RateLimited'];
export type ResponseServiceUnavailable = components['responses']['ServiceUnavailable'];
export type ResponseUnauthorized = components['responses']['Unauthorized'];
export type ResponseUnprocessableEntity = components['responses']['UnprocessableEntity'];
export type ResponseUnsupportedMediaType = components['responses']['UnsupportedMediaType'];
export type $defs = Record<string, never>;
export interface operations {
  AuthController_login: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LoginRequest'];
      };
    };
    responses: {
      /** @description Session created. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UserEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  AuthController_logout: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Session revoked. */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  AuthController_requestMobileOtp: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RequestMobileOtpRequest'];
      };
    };
    responses: {
      /** @description Mobile OTP challenge accepted. */
      202: {
        headers: {
          'Cache-Control'?: 'no-store';
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MobileOtpChallengeEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  AuthController_verifyMobileOtp: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['VerifyMobileOtpRequest'];
      };
    };
    responses: {
      /** @description Mobile OTP verified and sole active session created. */
      200: {
        headers: {
          'Cache-Control'?: 'no-store';
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MobileOtpVerificationEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  AuthController_register: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RegisterRequest'];
      };
    };
    responses: {
      /** @description Registration accepted. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RegistrationEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  AuthController_session: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current session. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UserEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  AuthController_verifyEmail: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['VerifyEmailRequest'];
      };
    };
    responses: {
      /** @description Email verified. */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  BalancesController_list: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Personal balances. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['BalanceListEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  ExpensesController_create: {
    parameters: {
      query?: never;
      header: {
        /** @description Stable 8–200 character key. Reuse is valid only with the identical request body. */
        'Idempotency-Key': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ExpenseMutationRequest'];
      };
    };
    responses: {
      /** @description Expense posted. */
      201: {
        headers: {
          'Idempotency-Replayed'?: 'true';
          Location?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ExpenseEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  ExpensesController_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Expense details. */
      200: {
        headers: {
          ETag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ExpenseEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  ExpensesController_update: {
    parameters: {
      query?: never;
      header: {
        /** @description Stable 8–200 character key. Reuse is valid only with the identical request body. */
        'Idempotency-Key': string;
        /** @description Current positive decimal expense version, optionally enclosed in double quotes. */
        'If-Match': string;
      };
      path: {
        expenseId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ExpenseMutationRequest'];
      };
    };
    responses: {
      /** @description Expense replaced by an immutable revision and balanced journal reversal. */
      200: {
        headers: {
          ETag?: string;
          'Idempotency-Replayed'?: 'true';
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ExpenseEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  ExpensesController_preview: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ExpenseMutationRequest'];
      };
    };
    responses: {
      /** @description Authoritative split preview. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SplitPreviewEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  GroupInvitationsController_accept: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['GroupInvitationTokenRequest'];
      };
    };
    responses: {
      /** @description Invitation accepted and membership activated. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GroupInvitationAcceptanceEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  GroupInvitationsController_preview: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['GroupInvitationTokenRequest'];
      };
    };
    responses: {
      /** @description Invitation details for the signed-in phone number. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GroupInvitationPreviewEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  GroupsController_list: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Visible groups. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GroupListEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  GroupsController_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateGroupRequest'];
      };
    };
    responses: {
      /** @description Group created. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GroupEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  GroupsController_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        groupId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Group details. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GroupDetailEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  GroupBalancesController_list: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        groupId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Group balances. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['BalanceListEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  GroupExpensesController_list: {
    parameters: {
      query?: {
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        groupId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Expense page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ExpensePageEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  MediaController_groupImage: {
    parameters: {
      query: {
        /** @description Immutable media identifier from the URL returned by the upload or resource API. */
        v: string;
      };
      header?: never;
      path: {
        groupId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Authorized versioned private group image. */
      200: {
        headers: {
          'Cache-Control'?: 'private, no-store';
          ETag?: string;
          Vary?: 'Cookie';
          'X-Content-Type-Options'?: 'nosniff';
          [name: string]: unknown;
        };
        content: {
          'image/webp': string;
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  MediaController_uploadGroupImage: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        groupId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'multipart/form-data': {
          /**
           * Format: binary
           * @description One JPEG, PNG, or WebP image, at most 10,000,000 bytes.
           */
          file: string;
        };
      };
    };
    responses: {
      /** @description Group image replaced. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MediaMutationEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  MediaController_deleteGroupImage: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        groupId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Group image deleted. */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  GroupsController_addMember: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        groupId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['AddGroupMemberRequest'];
      };
    };
    responses: {
      /** @description A registered account was added to the group. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RegisteredGroupMemberEnvelope'];
        };
      };
      /** @description The account is not registered; a phone-bound registration and join invitation was sent. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GroupInvitationSentEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  HealthController_live: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Process is live. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LiveStatus'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  HealthController_ready: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Oracle is ready. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ReadyStatus'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  MeController_me: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current user. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UserEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  MediaController_uploadAvatar: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'multipart/form-data': {
          /**
           * Format: binary
           * @description One JPEG, PNG, or WebP image, at most 10,000,000 bytes.
           */
          file: string;
        };
      };
    };
    responses: {
      /** @description Avatar replaced. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MediaMutationEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  MediaController_deleteAvatar: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Avatar deleted. */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  MediaController_participantAvatar: {
    parameters: {
      query: {
        /** @description Immutable media identifier from the URL returned by the upload or resource API. */
        v: string;
      };
      header?: never;
      path: {
        participantId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Authorized versioned private participant avatar. */
      200: {
        headers: {
          'Cache-Control'?: 'private, no-store';
          ETag?: string;
          Vary?: 'Cookie';
          'X-Content-Type-Options'?: 'nosniff';
          [name: string]: unknown;
        };
        content: {
          'image/webp': string;
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  SettlementsController_create: {
    parameters: {
      query?: never;
      header: {
        /** @description Stable 8–200 character key. Reuse is valid only with the identical request body. */
        'Idempotency-Key': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateSettlementRequest'];
      };
    };
    responses: {
      /** @description Settlement posted. */
      201: {
        headers: {
          'Idempotency-Replayed'?: 'true';
          Location?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SettlementCreatedEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
  SettlementsController_preview: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SettlementPreviewRequest'];
      };
    };
    responses: {
      /** @description Settlement preview. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SettlementPreviewEnvelope'];
        };
      };
      400: components['responses']['BadRequest'];
      401: components['responses']['Unauthorized'];
      403: components['responses']['Forbidden'];
      404: components['responses']['NotFound'];
      409: components['responses']['Conflict'];
      412: components['responses']['PreconditionFailed'];
      413: components['responses']['PayloadTooLarge'];
      415: components['responses']['UnsupportedMediaType'];
      422: components['responses']['UnprocessableEntity'];
      428: components['responses']['PreconditionRequired'];
      429: components['responses']['RateLimited'];
      500: components['responses']['InternalError'];
      502: components['responses']['BadGateway'];
      503: components['responses']['ServiceUnavailable'];
    };
  };
}
