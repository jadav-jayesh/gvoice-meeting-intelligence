import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../auth/AuthLayout";
import { FormField } from "../auth/FormField";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/Icon";
import {
  emailValidator,
  passwordRequired,
  submitFields,
  useField
} from "../auth/useField";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const email = useField("", emailValidator);
  const password = useField("", passwordRequired);

  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTopError(null);

    const firstInvalid = submitFields([email, password]);
    if (firstInvalid) {
      firstInvalid.ref.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await login({ email: email.value.trim().toLowerCase(), password: password.value });
      const next = params.get("next");
      navigate(next && next.startsWith("/") ? next : "/dashboard", { replace: true });
    } catch (err) {
      setTopError(
        err instanceof Error && /401/.test(err.message)
          ? "Email or password is incorrect."
          : "Something went wrong. Please try again."
      );
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in — your summaries, transcripts and action items are waiting."
      footer={
        <>
          New to gVoice?{" "}
          <Link to="/signup" className="text-brand-600 dark:text-brand-400 font-medium hover:underline">
            Create an account
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

        <FormField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@company.com"
          leadingIcon={<Icon.Mail size={15} />}
          error={email.error}
          autoFocus
          required
          {...email.inputProps}
        />

        <FormField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          leadingIcon={<Icon.Lock size={15} />}
          error={password.error}
          showPasswordToggle
          required
          {...password.inputProps}
        />

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
