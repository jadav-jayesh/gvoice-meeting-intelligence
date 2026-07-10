import { useCallback, useMemo, useRef, useState } from "react";

export type Validator = (value: string) => string | null;

export interface Field {
  value: string;
  setValue: (value: string) => void;
  touched: boolean;
  setTouched: (touched: boolean) => void;
  // The error to display right now — null until the field has been touched.
  error: string | null;
  // Synchronously runs the validator on the current value. Use this from
  // submit handlers where `error` may be stale (a field not yet touched).
  validate: () => string | null;
  ref: React.RefObject<HTMLInputElement>;
  // Spread onto an <input>: handles change. Errors are surfaced by the submit
  // handler (via submitFields) — blur deliberately does NOT mark the field
  // touched, so users don't see "required" until they actually try to submit.
  inputProps: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    ref: React.RefObject<HTMLInputElement>;
  };
}

// Lightweight field hook: stays quiet until the form is submitted. Once a
// field has been marked touched by `submitFields`, it re-validates on every
// keystroke so the error clears as the user types the fix.
export function useField(initial: string, validator: Validator): Field {
  const [value, setValueState] = useState(initial);
  const [touched, setTouched] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const error = useMemo(() => (touched ? validator(value) : null), [touched, value, validator]);

  const validate = useCallback(() => validator(value), [value, validator]);

  const setValue = useCallback((next: string) => setValueState(next), []);

  const inputProps = useMemo(
    () => ({
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValueState(e.target.value),
      ref
    }),
    [value]
  );

  return { value, setValue, touched, setTouched, error, validate, ref, inputProps };
}

// Common validators
export const emailValidator: Validator = (v) => {
  const trimmed = v.trim();
  if (!trimmed) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Enter a valid email address";
  return null;
};

export const passwordRequired: Validator = (v) => (v ? null : "Password is required");

export const passwordMin = (min: number): Validator => (v) => {
  if (!v) return "Password is required";
  if (v.length < min) return `Use at least ${min} characters`;
  return null;
};

// Strong-password policy: 8+ chars, at least one upper, one lower, one digit,
// one special. Kept in sync with the server-side `strongPassword` Zod schema
// in src/routes/auth.ts — change both together.
export interface PasswordChecks {
  length: boolean;
  upper: boolean;
  lower: boolean;
  digit: boolean;
  special: boolean;
}

const SPECIAL_RE = /[!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`~]/;

export function passwordChecks(value: string): PasswordChecks {
  return {
    length: value.length >= 8,
    upper: /[A-Z]/.test(value),
    lower: /[a-z]/.test(value),
    digit: /\d/.test(value),
    special: SPECIAL_RE.test(value)
  };
}

export const strongPassword: Validator = (v) => {
  if (!v) return "Password is required";
  const c = passwordChecks(v);
  if (c.length && c.upper && c.lower && c.digit && c.special) return null;
  return "Must include uppercase, lowercase, number, and special character (8+ chars)";
};

export const matchesValue = (other: () => string, message = "Values do not match"): Validator => (v) =>
  v === other() ? null : message;

export const requiredName = (label: string): Validator => (v) => {
  const trimmed = v.trim();
  if (trimmed.length === 0) return `${label} is required`;
  if (trimmed.length > 80) return `${label} must be 80 characters or fewer`;
  return null;
};

// Run validators synchronously across many fields. Marks them touched (so the
// errors render), and returns the first one that's still invalid for focusing.
export function submitFields(fields: Field[]): Field | null {
  let firstInvalid: Field | null = null;
  for (const f of fields) {
    f.setTouched(true);
    if (!firstInvalid && f.validate() != null) firstInvalid = f;
  }
  return firstInvalid;
}
