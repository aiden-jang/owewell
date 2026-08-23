import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/*
 * Choosing a photo to go with an expense.
 *
 * Holds the file, not an upload: nothing leaves the device until the expense it belongs to exists,
 * so abandoning the form leaves nothing behind to clean up. The preview is a local object URL, which
 * is why it has to be revoked when the choice changes or the form goes away.
 *
 * `capture` is deliberately absent. On a phone the accept filter already offers the camera, and
 * forcing it would take away the case that actually happens: the receipt you photographed an hour
 * ago and are only splitting now.
 */
export function ReceiptPicker({
  file,
  onChange,
  disabled,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        aria-label="Receipt photo"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {preview ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-field px-3 py-2.5">
          <img src={preview} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{file?.name}</span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              // Or picking the same file again fires no change event and the preview never returns.
              if (inputRef.current) inputRef.current.value = '';
            }}
            className="shrink-0 rounded-full px-2 py-1 text-sm font-medium text-muted transition hover:text-neg"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong py-2.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink disabled:opacity-60"
        >
          <Icon name="scan" size={15} /> Add a photo of the receipt
        </button>
      )}
    </div>
  );
}
