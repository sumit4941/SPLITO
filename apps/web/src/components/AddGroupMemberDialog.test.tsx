import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddGroupMemberDialog } from './AddGroupMemberDialog';

describe('AddGroupMemberDialog', () => {
  afterEach(cleanup);

  it('normalizes a mobile number and reports an existing account as an active member', async () => {
    const onAdd = vi.fn().mockResolvedValue({
      outcome: 'member_added',
      member: { id: 'member-1', displayName: 'Riya', role: 'member', status: 'active' },
    });
    render(
      <AddGroupMemberDialog groupName="Goa weekend" onAdd={onAdd} onOpenChange={vi.fn()} open />,
    );

    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '98765 43210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add or invite' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('+919876543210'));
    expect(await screen.findByText('Riya is in the group')).toBeInTheDocument();
    expect(screen.getByText('Active member')).toBeInTheDocument();
  });

  it('keeps an unregistered invite pending until the recipient verifies and accepts', async () => {
    const onAdd = vi.fn().mockResolvedValue({
      outcome: 'invitation_sent',
      invitation: {
        id: 'invite-1',
        maskedMobileNumber: '+91 •••••• 4321',
        expiresAt: '2026-09-20T12:00:00.000Z',
        status: 'pending',
      },
      developmentJoinUrl: 'http://localhost:5173/join#invite=token',
    });
    render(
      <AddGroupMemberDialog groupName="Goa weekend" onAdd={onAdd} onOpenChange={vi.fn()} open />,
    );

    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add or invite' }));

    expect(await screen.findByText('Invitation sent')).toBeInTheDocument();
    expect(screen.getByText(/become a member only after verifying/i)).toBeInTheDocument();
    expect(screen.queryByText('Active member')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Development invitation link')).toHaveValue(
      'http://localhost:5173/join#invite=token',
    );
  });

  it('rejects an invalid number before calling the API', () => {
    const onAdd = vi.fn();
    render(
      <AddGroupMemberDialog groupName="Goa weekend" onAdd={onAdd} onOpenChange={vi.fn()} open />,
    );

    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add or invite' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid mobile number');
    expect(onAdd).not.toHaveBeenCalled();
  });
});
