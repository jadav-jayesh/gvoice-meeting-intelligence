import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  trailingIcon,
  loading,
  block,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "relative inline-flex items-center justify-center gap-1.5 rounded-lg font-medium select-none",
        "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-spring focus-ring",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" && "h-8 px-3 text-[12.5px]",
        size === "md" && "h-9 px-3.5 text-[13px]",
        size === "lg" && "h-10 px-4 text-[13.5px]",
        block && "w-full",
        variant === "primary" &&
          "text-white bg-gradient-to-b from-brand-500 to-brand-600 border border-brand-600 shadow-sm hover:from-brand-500 hover:to-brand-700 active:translate-y-px",
        variant === "secondary" &&
          "bg-surface text-ink border border-line hover:bg-surfaceHi hover:border-lineHi shadow-sm",
        variant === "ghost" &&
          "bg-transparent text-inkSoft hover:text-ink hover:bg-surfaceHi",
        variant === "danger" &&
          "text-white bg-negative border border-negative hover:bg-negativeHi shadow-sm",
        className
      )}
    >
      {loading ? (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      {children}
      {trailingIcon && <span className="shrink-0">{trailingIcon}</span>}
    </button>
  );
}
