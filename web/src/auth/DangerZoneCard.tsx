import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/Icon";
import { FormField } from "./FormField";
import { useAuth } from "./AuthProvider";

/**
 * Account deletion (right to erasure). Two-step to prevent accidents:
 * reveal a confirmation panel, then require the password before the
 * irreversible delete runs. On success the user is dropped to anonymous and
 * sent to the landing page.
 */
export function DangerZoneCard() {
  const { deleteAccount } = useAuth();
  const navigate = useNavigate();

  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setConfirming(false);
    setPassword("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }
    setSubmitting(true);
    try {
      await deleteAccount(password);
      navigate("/?deleted=1", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (/current_password_incorrect/i.test(message) || /400/.test(message)) {
        setError("Password is incorrect.");
      } else {
        setError("Couldn't delete your account. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <Card padded className="border-negative/30">
      <div className="space-y-1 pb-5 border-b border-negative/20">
        <h2 className="text-[16px] font-semibold tracking-tighter2 text-negative">Delete account</h2>
        <p className="text-[13px] text-inkMute">
          Permanently delete your account and all associated data — meetings you own, recordings,
          transcripts and reports. This action cannot be undone.
        </p>
      </div>

      {!confirming ? (
        <div className="flex justify-end pt-5">
          <Button variant="danger" size="md" onClick={() => setConfirming(true)}>
            Delete account
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="pt-5 space-y-5">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/5 px-3 py-2.5 text-[12.5px] text-negative"
          >
            <Icon.AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              This will permanently delete your account and all data we hold for you. Meetings still
              shared with other people remain visible to them. Enter your password to confirm.
            </span>
          </div>

          <FormField
            label="Password"
            type="password"
            name="confirmDeletePassword"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
            showPasswordToggle
            required
          />

          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="ghost" size="md" onClick={cancel} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" size="md" loading={submitting}>
              Permanently delete
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
