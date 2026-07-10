import clsx from "clsx";
import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode
} from "react";
import { Icon } from "../components/Icon";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  showPasswordToggle?: boolean;
  leadingIcon?: ReactNode;
}

export const FormField = forwardRef<HTMLInputElement, Props>(function FormField(
  { label, hint, error, showPasswordToggle, leadingIcon, type = "text", className, id, ...rest },
  ref
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;

  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const effectiveType = isPassword && showPasswordToggle && revealed ? "text" : type;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={fieldId}
        className="block text-[12.5px] font-medium text-inkSoft"
      >
        {label}
      </label>
      <div className="relative group">
        {leadingIcon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-inkMute group-focus-within:text-brand-500 dark:group-focus-within:text-brand-400 transition-colors">
            {leadingIcon}
          </span>
        )}
        <input
          {...rest}
          id={fieldId}
          ref={ref}
          type={effectiveType}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className={clsx(
            "block w-full h-11 rounded-lg bg-surfaceHi text-ink",
            "border border-line",
            "px-3.5 text-[13.5px] placeholder:text-inkFaint",
            "transition-[border-color,box-shadow,background-color] duration-150",
            "outline-none focus:border-brand-500 focus:bg-surface",
            "focus:shadow-[0_0_0_4px_rgb(34_197_94/0.15)]",
            "disabled:opacity-60 disabled:cursor-not-allowed",
            leadingIcon && "pl-10",
            isPassword && showPasswordToggle && "pr-11",
            error && "border-negative focus:border-negative focus:shadow-[0_0_0_4px_rgb(220_38_38/0.15)]",
            className
          )}
        />
        {isPassword && showPasswordToggle && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 inline-flex items-center justify-center rounded-md text-inkMute hover:text-ink hover-soft focus-ring"
          >
            <PasswordToggleIcon revealed={revealed} />
          </button>
        )}
      </div>
      {hint && !error && (
        <p id={hintId} className="text-[11.5px] text-inkMute">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[11.5px] text-negative flex items-center gap-1">
          <Icon.AlertCircle size={12} />
          {error}
        </p>
      )}
    </div>
  );
});

function PasswordToggleIcon({ revealed }: { revealed: boolean }) {
  if (revealed) {
    return (
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 3l18 18" />
        <path d="M10.6 6.1A11 11 0 0 1 12 6c6 0 10 6 10 6a18 18 0 0 1 -3.1 3.7" />
        <path d="M6.6 6.6A18 18 0 0 0 2 12s4 6 10 6a11 11 0 0 0 4.4 -.9" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </svg>
    );
  }
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s4 -6 10 -6 10 6 10 6 -4 6 -10 6 -10 -6 -10 -6z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
