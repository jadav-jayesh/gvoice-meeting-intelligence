import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../auth/AuthLayout";
import { FormField } from "../auth/FormField";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/Icon";
import {
  emailValidator,
  requiredName,
  strongPassword,
  submitFields,
  useField
} from "../auth/useField";
import { PasswordRequirements } from "../auth/PasswordRequirements";

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const firstName = useField("", requiredName("First name"));
  const lastName = useField("", requiredName("Last name"));
  const email = useField("", emailValidator);
  const password = useField("", strongPassword);

  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTopError(null);

    const firstInvalid = submitFields([firstName, lastName, email, password]);
    if (firstInvalid) {
      firstInvalid.ref.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await signup({
        firstName: firstName.value.trim(),
        lastName: lastName.value.trim(),
        email: email.value.trim().toLowerCase(),
        password: password.value
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (/409/.test(message) || /email_already_registered/i.test(message)) {
        // Surface as an inline field error on email and focus it.
        email.setTouched(true);
        email.setValue(email.value); // trigger re-render
        setTopError("An account with this email already exists. Try signing in instead.");
        email.ref.current?.focus();
      } else {
        setTopError("Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start capturing every meeting in 60 seconds."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-brand-600 dark:text-brand-400 font-medium hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {topError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/5 px-3 py-2.5 text-[12.5px] text-negative"
          >
            <Icon.AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{topError}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="First name"
            name="firstName"
            autoComplete="given-name"
            placeholder="Ada"
            leadingIcon={<Icon.User size={15} />}
            error={firstName.error}
            autoFocus
            required
            {...firstName.inputProps}
          />
          <FormField
            label="Last name"
            name="lastName"
            autoComplete="family-name"
            placeholder="Lovelace"
            leadingIcon={<Icon.User size={15} />}
            error={lastName.error}
            required
            {...lastName.inputProps}
          />
        </div>

        <FormField
          label="Work email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@company.com"
          leadingIcon={<Icon.Mail size={15} />}
          error={email.error}
          required
          {...email.inputProps}
        />

        <div className="space-y-2">
          <FormField
            label="Password"
            type="password"
            name="password"
            autoComplete="new-password"
            placeholder="Create a strong password"
            leadingIcon={<Icon.Lock size={15} />}
            error={password.error}
            showPasswordToggle
            required
            {...password.inputProps}
          />
          <PasswordRequirements value={password.value} />
        </div>

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>

        <p className="text-[11.5px] text-inkFaint text-center">
          By signing up you agree to our{" "}
          <Link to="/terms" className="font-medium text-accent hover:underline">Terms &amp; Conditions</Link>{" "}
          and{" "}
          <Link to="/privacy" className="font-medium text-accent hover:underline">Privacy Policy</Link>.
        </p>
      </form>
    </AuthLayout>
  );
}
