import { Button, ErrorState, Modal, StatusBadge, cn } from '@splito/ui';
import {
  Check,
  ChevronDown,
  Copy,
  MessageSquareText,
  Phone,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { dialingCountries, maskMobileNumber, normalizeMobileNumber } from '../auth/mobile';
import type { AddGroupMemberResult } from '../types';
import { friendlyApiError } from '../api/client';
import { Avatar } from './PageElements';

interface AddGroupMemberDialogProps {
  groupName: string;
  onAdd: (mobileNumber: string) => Promise<AddGroupMemberResult>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'soon';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function AddGroupMemberDialog({
  groupName,
  onAdd,
  onOpenChange,
  open,
}: AddGroupMemberDialogProps) {
  const [countryCode, setCountryCode] = useState('IN');
  const [nationalNumber, setNationalNumber] = useState('');
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AddGroupMemberResult>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const country = useMemo(
    () => dialingCountries.find((item) => item.code === countryCode) ?? dialingCountries[0],
    [countryCode],
  );

  useEffect(() => {
    if (!open) return;
    setNationalNumber('');
    setError(undefined);
    setResult(undefined);
    setCopied(false);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const mobileNumber = normalizeMobileNumber(country.dialCode, nationalNumber);
    if (!mobileNumber) {
      setError('Enter a valid mobile number, including its area or network code.');
      inputRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      setResult(await onAdd(mobileNumber));
    } catch (caught) {
      setError(friendlyApiError(caught));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onOpenChange(false);
  };

  return (
    <Modal
      description={`Add a verified SPLITO account to ${groupName}, or send a secure invitation.`}
      onOpenChange={(nextOpen) => {
        if (nextOpen || !busy) onOpenChange(nextOpen);
      }}
      open={open}
      title="Add a person"
    >
      {result?.outcome === 'member_added' ? (
        <div className="member-result" role="status">
          <span className="member-result__icon member-result__icon--added">
            <UserCheck aria-hidden="true" />
          </span>
          <StatusBadge tone="positive">Member added</StatusBadge>
          <h3>{result.member.displayName} is in the group</h3>
          <p>They already had a verified SPLITO account and can now view this group’s expenses.</p>
          <div className="member-result__person">
            <Avatar participant={result.member} />
            <span>
              <strong>{result.member.displayName}</strong>
              <small>Active member</small>
            </span>
            <Check aria-hidden="true" />
          </div>
          <Button onClick={close}>Done</Button>
        </div>
      ) : result?.outcome === 'invitation_sent' ? (
        <div className="member-result" role="status">
          <span className="member-result__icon member-result__icon--invited">
            <MessageSquareText aria-hidden="true" />
          </span>
          <StatusBadge tone="info">SMS invitation queued</StatusBadge>
          <h3>Invitation sent</h3>
          <p>
            {result.invitation.maskedMobileNumber || maskMobileNumber(nationalNumber)} is not
            registered yet. They will become a member only after verifying that number and accepting
            the invite.
          </p>
          <div className="member-result__expiry">
            <ShieldCheck aria-hidden="true" />
            <span>
              <strong>Phone-bound and single use</strong>
              <small>Expires {formatExpiry(result.invitation.expiresAt)}</small>
            </span>
          </div>
          {result.developmentJoinUrl && (
            <div className="development-invite" role="note">
              <label htmlFor="development-invite-link">Development invitation link</label>
              <div>
                <input id="development-invite-link" readOnly value={result.developmentJoinUrl} />
                <Button
                  aria-label="Copy development invitation link"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(result.developmentJoinUrl!);
                    setCopied(true);
                  }}
                  size="icon"
                  type="button"
                  variant="secondary"
                >
                  <Copy aria-hidden="true" size={17} />
                </Button>
              </div>
              <small>
                {copied ? 'Copied to clipboard.' : 'Available only during local development.'}
              </small>
            </div>
          )}
          <Button onClick={close}>Done</Button>
        </div>
      ) : (
        <form className="member-add-form" noValidate onSubmit={submit}>
          <div className="member-add-form__intro">
            <span>
              <UserPlus aria-hidden="true" />
            </span>
            <div>
              <strong>Enter their mobile number</strong>
              <p>
                Registered people join now. Everyone else receives a secure sign-up link by SMS.
              </p>
            </div>
          </div>

          {error && <ErrorState description={error} title="Person not added" />}

          <label className="member-phone-field" htmlFor="group-member-mobile">
            <span>Mobile number</span>
            <span className={cn('member-phone-control', error && 'member-phone-control--error')}>
              <Phone aria-hidden="true" size={18} />
              <span className="member-country-select">
                <select
                  aria-label="Country or region"
                  disabled={busy}
                  onChange={(event) => setCountryCode(event.target.value)}
                  value={countryCode}
                >
                  {dialingCountries.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.flag} {item.name} ({item.dialCode})
                    </option>
                  ))}
                </select>
                <span aria-hidden="true">
                  {country.flag} {country.dialCode} <ChevronDown size={14} />
                </span>
              </span>
              <input
                aria-label="Mobile number"
                aria-describedby="group-member-mobile-help"
                aria-invalid={Boolean(error)}
                autoComplete="tel-national"
                disabled={busy}
                id="group-member-mobile"
                inputMode="tel"
                onChange={(event) => {
                  setNationalNumber(event.target.value);
                  setError(undefined);
                }}
                placeholder={country.example}
                ref={inputRef}
                type="tel"
                value={nationalNumber}
              />
            </span>
            <small id="group-member-mobile-help">
              Only verified accounts become active members or appear in expense splits.
            </small>
          </label>

          <div className="member-add-form__assurance">
            <ShieldCheck aria-hidden="true" />
            <span>
              The invitation is tied to this exact number. A different signed-in account cannot
              claim it.
            </span>
          </div>

          <div className="form-actions">
            <Button disabled={busy} onClick={close} type="button" variant="ghost">
              Cancel
            </Button>
            <Button busy={busy} icon={UserPlus} type="submit">
              {busy ? 'Checking…' : 'Add or invite'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
