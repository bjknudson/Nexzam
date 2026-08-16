import { useEffect, useState } from "react";

export type BankPropertiesMode = "create" | "edit" | "save-as";

const MODE_TEXT: Record<BankPropertiesMode, { heading: string; submitLabel: string }> = {
  create: { heading: "New Bank", submitLabel: "Create" },
  "save-as": { heading: "Save Bank As", submitLabel: "Create" },
  edit: { heading: "Bank Properties", submitLabel: "Save" },
};

interface BankPropertiesDialogProps {
  open: boolean;
  mode: BankPropertiesMode;
  initialTitle: string;
  initialDescription: string;
  onClose: () => void;
  onSubmit: (title: string, description: string) => Promise<boolean>;
}

function BankPropertiesDialog({
  open,
  mode,
  initialTitle,
  initialDescription,
  onClose,
  onSubmit,
}: BankPropertiesDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setDescription(initialDescription);
    setError("");
    setSubmitting(false);
  }, [open, initialTitle, initialDescription]);

  if (!open) return null;

  async function handleSubmit() {
    if (!title.trim()) {
      setError("Name is required.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const succeeded = await onSubmit(title.trim(), description.trim());
      if (succeeded) {
        onClose();
      }
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const { heading, submitLabel } = MODE_TEXT[mode];

  return (
    <div className="settings-overlay" onClick={submitting ? undefined : onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <h2>{heading}</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <label className="bank-properties-field">
              Name
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Bank name"
                autoFocus
              />
            </label>
            <label className="bank-properties-field">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional description"
              />
            </label>
            {error ? <p className="bank-properties-error">{error}</p> : null}
          </section>
        </div>

        <div className="bank-properties-actions">
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !title.trim()}
          >
            {submitting ? "Working…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BankPropertiesDialog;
