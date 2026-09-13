import { Button, ErrorState, Modal, cn } from '@splito/ui';
import { Camera, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useEffect, useId, useState, type ChangeEvent, type DragEvent } from 'react';
import { friendlyApiError } from '../api/client';
import { formatImageBytes, IMAGE_UPLOAD_ACCEPT, validateImageFile } from '../media/images';

export interface ImageUploadDialogProps {
  currentUrl?: string;
  displayName: string;
  kind: 'profile' | 'group';
  onOpenChange: (open: boolean) => void;
  onRemove?: () => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  open: boolean;
}

export function ImageUploadDialog({
  currentUrl,
  displayName,
  kind,
  onOpenChange,
  onRemove,
  onUpload,
  open,
}: ImageUploadDialogProps) {
  const inputId = useId();
  const hintId = useId();
  const noun = kind === 'profile' ? 'profile picture' : 'group picture';
  const [selected, setSelected] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [pendingAction, setPendingAction] = useState<'upload' | 'remove'>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [currentUrl, previewUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (open) return;
    setSelected(undefined);
    setPreviewUrl(undefined);
    setError(undefined);
    setSuccess(undefined);
    setConfirmRemove(false);
    setDragging(false);
  }, [open]);

  const chooseFile = (file?: File) => {
    setSuccess(undefined);
    setConfirmRemove(false);
    if (!file) return;
    const validationError = validateImageFile(file);
    if (validationError) {
      setSelected(undefined);
      setPreviewUrl(undefined);
      setError(validationError);
      return;
    }
    setError(undefined);
    setSelected(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  };

  const upload = async () => {
    if (!selected) return;
    setError(undefined);
    setSuccess(undefined);
    setPendingAction('upload');
    try {
      await onUpload(selected);
      setSelected(undefined);
      setPreviewUrl(undefined);
      setSuccess(`${kind === 'profile' ? 'Profile' : 'Group'} picture updated.`);
    } catch (uploadError) {
      setError(friendlyApiError(uploadError));
    } finally {
      setPendingAction(undefined);
    }
  };

  const remove = async () => {
    if (!onRemove) return;
    setError(undefined);
    setSuccess(undefined);
    setPendingAction('remove');
    try {
      await onRemove();
      setSelected(undefined);
      setPreviewUrl(undefined);
      setConfirmRemove(false);
      setSuccess(`${kind === 'profile' ? 'Profile' : 'Group'} picture removed.`);
    } catch (removeError) {
      setError(friendlyApiError(removeError));
    } finally {
      setPendingAction(undefined);
    }
  };

  const source = previewUrl ?? currentUrl;
  const initial =
    displayName
      .trim()
      .slice(0, kind === 'group' ? 2 : 1)
      .toUpperCase() || '?';
  const busy = Boolean(pendingAction);

  return (
    <Modal
      description={`Use a JPEG, PNG, or WebP image. The maximum file size is 10 MB.`}
      onOpenChange={onOpenChange}
      open={open}
      title={kind === 'profile' ? 'Profile picture' : 'Group picture'}
    >
      <div aria-busy={busy} className={cn('image-upload', `image-upload--${kind}`)}>
        <div className="image-upload__stage">
          <div className="image-upload__halo" aria-hidden="true" />
          <div className="image-upload__preview">
            {source && !imageFailed ? (
              <img
                alt={previewUrl ? `Preview of new ${noun}` : ''}
                onError={() => setImageFailed(true)}
                src={source}
              />
            ) : (
              <span aria-hidden="true">{initial}</span>
            )}
            {busy && (
              <span className="image-upload__busy" role="status">
                <Upload aria-hidden="true" />
                {pendingAction === 'remove' ? `Removing ${noun}…` : `Uploading ${noun}…`}
              </span>
            )}
          </div>
        </div>

        <label
          className={cn('image-upload__picker', dragging && 'image-upload__picker--dragging')}
          htmlFor={inputId}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <input
            accept={IMAGE_UPLOAD_ACCEPT}
            aria-describedby={hintId}
            aria-label={`Choose ${noun}`}
            disabled={busy}
            id={inputId}
            onChange={handleChange}
            type="file"
          />
          <span className="image-upload__picker-icon">
            {selected ? <Camera aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
          </span>
          <span>
            <strong>{selected ? selected.name : `Choose ${noun}`}</strong>
            <small id={hintId}>
              {selected
                ? `${formatImageBytes(selected.size)} · Ready to upload`
                : 'Select an image or drop it here · JPEG, PNG, or WebP'}
            </small>
          </span>
        </label>

        {error && <ErrorState description={error} title={`${noun} not updated`} />}
        {success && (
          <div className="image-upload__success" role="status">
            {success}
          </div>
        )}

        {confirmRemove && currentUrl && !selected && (
          <div className="image-upload__confirm" role="group" aria-label={`Remove ${noun}`}>
            <p>The colorful initials will be shown instead.</p>
            <div>
              <Button disabled={busy} onClick={() => setConfirmRemove(false)} variant="ghost">
                Keep picture
              </Button>
              <Button
                busy={pendingAction === 'remove'}
                onClick={() => void remove()}
                variant="danger"
              >
                Remove picture
              </Button>
            </div>
          </div>
        )}

        <div className="image-upload__actions">
          {currentUrl && onRemove && !selected && !confirmRemove && (
            <Button
              disabled={busy}
              icon={Trash2}
              onClick={() => {
                setError(undefined);
                setSuccess(undefined);
                setConfirmRemove(true);
              }}
              variant="ghost"
            >
              Remove {noun}
            </Button>
          )}
          <span />
          <Button disabled={busy} onClick={() => onOpenChange(false)} variant="secondary">
            {success ? 'Done' : 'Cancel'}
          </Button>
          {selected && (
            <Button busy={pendingAction === 'upload'} onClick={() => void upload()}>
              Upload {noun}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
