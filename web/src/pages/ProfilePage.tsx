import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { FormField } from "../auth/FormField";
import { ChangePasswordCard } from "../auth/ChangePasswordCard";
import { DangerZoneCard } from "../auth/DangerZoneCard";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Avatar } from "../components/ui/Avatar";
import { Icon } from "../components/Icon";

export function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string }>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
  }, [user?.firstName, user?.lastName]);

  if (!user) return null;

  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const dirty = firstName !== user.firstName || lastName !== user.lastName;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTopError(null);
    setSaved(false);

    const next: typeof errors = {};
    if (!firstName.trim()) next.firstName = "First name is required";
    if (!lastName.trim()) next.lastName = "Last name is required";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await updateProfile({ firstName: firstName.trim(), lastName: lastName.trim() });
      setSaved(true);
    } catch {
      setTopError("Couldn't save changes. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card padded>
        <div className="flex items-center gap-4 pb-5 border-b border-line">
          <Avatar name={fullName || user.email} size={56} />
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-ink truncate">{fullName || user.email}</p>
            <p className="text-[12.5px] text-inkMute truncate">{user.email}</p>
          </div>
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
              Changes saved.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField
              label="First name"
              name="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              error={errors.firstName}
              required
            />
            <FormField
              label="Last name"
              name="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              error={errors.lastName}
              required
            />
          </div>

          <FormField
            label="Email"
            name="email"
            value={user.email}
            readOnly
            disabled
            hint="Email cannot be changed from this screen."
          />

          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="md" disabled={!dirty} loading={submitting}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>

      <ChangePasswordCard />

      <DangerZoneCard />
    </div>
  );
}
