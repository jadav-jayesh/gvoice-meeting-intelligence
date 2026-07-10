import { useState, type FormEvent } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/Icon";
import { FormField } from "./FormField";
import { PasswordRequirements } from "./PasswordRequirements";
import {
  matchesValue,
  passwordRequired,
  strongPassword,
  submitFields,
  useField
} from "./useField";
import { changePassword } from "../lib/api";

export function ChangePasswordCard() {
  const current = useField("", passwordRequired);
  const next = useField("", strongPassword);
  const confirm = useField("", matchesValue(() => next.value, "Passwords don't match"));

  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function reset() {
    current.setValue("");
    next.setValue("");
    confirm.setValue("");
    current.setTouched(false);
    next.setTouched(false);
    confirm.setTouched(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTopError(null);
    setSaved(false);

    const firstInvalid = submitFields([current, next, confirm]);
    if (firstInvalid) {
      firstInvalid.ref.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await changePassword({
        currentPassword: current.value,
        newPassword: next.value
      });
      setSaved(true);
      reset();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (/current_password_incorrect/i.test(message) || /400/.test(message)) {
        setTopError("Current password is incorrect.");
        current.ref.current?.focus();
      } else {
        setTopError("Couldn't update password. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card padded>
      <div className="space-y-1 pb-5 border-b border-line">
        <h2 className="text-[16px] font-semibold tracking-tighter2 text-ink">Password</h2>
        <p className="text-[13px] text-inkMute">
          Choose a strong password you don't reuse elsewhere.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="pt-5 space-y-5">
        {topError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/5 px-3 py-2.5 text-[12.5px] text-negative"
          >
            <Icon.AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{topError}</span>
          </div>
        )}
        {saved && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-lg border border-positive/30 bg-positive/5 px-3 py-2.5 text-[12.5px] text-positive"
          >
            <Icon.CheckCircle size={14} />
            Password updated.
          </div>
        )}

        <FormField
          label="Current password"
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          placeholder="Enter your current password"
          error={current.error}
          showPasswordToggle
          required
          {...current.inputProps}
        />

        <div className="space-y-2">
          <FormField
            label="New password"
            type="password"
            name="newPassword"
            autoComplete="new-password"
            placeholder="Create a strong password"
            error={next.error}
            showPasswordToggle
            required
            {...next.inputProps}
          />
          <PasswordRequirements value={next.value} />
        </div>

        <FormField
          label="Confirm new password"
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          error={confirm.error}
          showPasswordToggle
          required
          {...confirm.inputProps}
        />

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="md" loading={submitting}>
            Update password
          </Button>
        </div>
      </form>
    </Card>
  );
}
