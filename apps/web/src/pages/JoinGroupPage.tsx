import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, ErrorState, StatusBadge } from '@splito/ui';
import { ArrowRight, CalendarClock, ShieldCheck, UserRoundCheck, UsersRound } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, friendlyApiError } from '../api/client';
import { PageSkeleton } from '../components/ApiStates';
import { PageIntro } from '../components/PageElements';
import {
  captureGroupInvitationToken,
  clearGroupInvitationToken,
  invitationTokenFromHash,
  readGroupInvitationToken,
} from '../lib/invitations';

function expiryLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'soon';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}

export function JoinGroupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token] = useState(
    () => invitationTokenFromHash(window.location.hash) ?? readGroupInvitationToken(),
  );

  useLayoutEffect(() => {
    captureGroupInvitationToken();
  }, []);

  const preview = useQuery({
    queryKey: ['group-invitation-preview'],
    queryFn: () => api.previewGroupInvitation(token!),
    enabled: Boolean(token),
    gcTime: 0,
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => api.acceptGroupInvitation(token!),
    async onSuccess(result) {
      clearGroupInvitationToken();
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      void navigate(`/groups/${result.groupId}`, {
        replace: true,
        state: { joined: true },
      });
    },
  });

  if (!token) {
    return (
      <div className="page-stack join-page">
        <PageIntro
          eyebrow="Secure group invitation"
          title="This invitation link is incomplete"
          description="Open the complete link from the SMS. Invitation tokens are never left in the address bar."
        />
        <ErrorState
          action={
            <Button asChild variant="secondary">
              <Link to="/groups">Go to your groups</Link>
            </Button>
          }
          description="The invitation token is missing or malformed. Ask the group administrator to send a fresh invitation."
          title="Invitation unavailable"
        />
      </div>
    );
  }

  if (preview.isLoading) return <PageSkeleton cards={2} />;

  if (preview.error || !preview.data) {
    return (
      <div className="page-stack join-page">
        <PageIntro
          eyebrow="Secure group invitation"
          title="This invitation cannot be opened"
          description="For privacy, invalid, expired, revoked, and number-mismatched invitations look the same."
        />
        <ErrorState
          action={
            <Button onClick={() => void preview.refetch()} variant="secondary">
              Try again
            </Button>
          }
          description={friendlyApiError(preview.error)}
          title="Invitation unavailable"
        />
      </div>
    );
  }

  const invitation = preview.data;
  return (
    <div className="page-stack join-page">
      <PageIntro
        eyebrow="Secure group invitation"
        title={`Join ${invitation.groupName}`}
        description={`${invitation.inviterDisplayName ?? 'A group administrator'} invited your verified mobile account to this group.`}
      />
      <Card className="join-card">
        <CardContent>
          <div className="join-card__art" aria-hidden="true">
            <UsersRound />
            <span />
          </div>
          <StatusBadge tone="info">
            <ShieldCheck aria-hidden="true" size={13} /> Phone verified
          </StatusBadge>
          <div className="join-card__copy">
            <h2>{invitation.groupName}</h2>
            <p>
              Joining lets you view every group expense and add your own entries. Only the person
              who created an expense can edit that entry.
            </p>
          </div>
          <div className="join-card__facts">
            <span>
              <UserRoundCheck aria-hidden="true" />
              <span>
                <strong>Invitation from</strong>
                <small>{invitation.inviterDisplayName ?? 'Group administrator'}</small>
              </span>
            </span>
            <span>
              <CalendarClock aria-hidden="true" />
              <span>
                <strong>Expires</strong>
                <small>{expiryLabel(invitation.expiresAt)}</small>
              </span>
            </span>
          </div>
          {accept.error && (
            <ErrorState description={friendlyApiError(accept.error)} title="Group not joined" />
          )}
          <div className="join-card__actions">
            <Button busy={accept.isPending} onClick={() => accept.mutate()} size="lg">
              {accept.isPending ? 'Joining…' : 'Join group'}
              {!accept.isPending && <ArrowRight aria-hidden="true" size={18} />}
            </Button>
            <Button
              onClick={() => {
                clearGroupInvitationToken();
                void navigate('/groups', { replace: true });
              }}
              variant="ghost"
            >
              Not now
            </Button>
          </div>
          <small className="join-card__privacy">
            The single-use invitation is bound to your signed-in mobile number. It cannot be
            transferred to another account.
          </small>
        </CardContent>
      </Card>
    </div>
  );
}
