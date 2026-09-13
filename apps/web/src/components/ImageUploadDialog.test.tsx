import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageUploadDialog } from './ImageUploadDialog';

describe('ImageUploadDialog', () => {
  beforeEach(() => {
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: vi.fn(() => 'blob:image-preview') },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    });
  });

  afterEach(cleanup);

  it('previews and uploads a valid profile picture', async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    render(
      <ImageUploadDialog
        displayName="Sumit"
        kind="profile"
        onOpenChange={vi.fn()}
        onUpload={onUpload}
        open
      />,
    );

    const file = new File([new Uint8Array([1, 2, 3])], 'sumit.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose profile picture'), {
      target: { files: [file] },
    });

    expect(screen.getByRole('img', { name: 'Preview of new profile picture' })).toHaveAttribute(
      'src',
      'blob:image-preview',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upload profile picture' }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
    expect(await screen.findByRole('status')).toHaveTextContent('Profile picture updated');
  });

  it('rejects unsupported files without uploading', () => {
    const onUpload = vi.fn();
    render(
      <ImageUploadDialog
        displayName="Weekend"
        kind="group"
        onOpenChange={vi.fn()}
        onUpload={onUpload}
        open
      />,
    );

    fireEvent.change(screen.getByLabelText('Choose group picture'), {
      target: { files: [new File(['gif'], 'animated.gif', { type: 'image/gif' })] },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPEG, PNG, or WebP image');
    expect(screen.queryByRole('button', { name: 'Upload group picture' })).not.toBeInTheDocument();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('asks for confirmation before removing a current image', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <ImageUploadDialog
        currentUrl="/current.webp"
        displayName="Weekend"
        kind="group"
        onOpenChange={vi.fn()}
        onRemove={onRemove}
        onUpload={vi.fn()}
        open
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove group picture' }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove picture' }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent('Group picture removed');
  });
});
