import clsx from "clsx";
import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  interactive?: boolean;
  padded?: boolean;
  feature?: boolean;
}

export function Card({
  children,
  className,
  interactive,
  padded,
  feature,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      className={clsx(
        "relative rounded-xl border border-line",
        feature ? "surface-feature" : "bg-surface",
        padded && "p-5 lg:p-6",
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-200 ease-spring hover:border-lineHi hover:shadow-md hover:-translate-y-px",
        className
      )}
    >
      {children}
    </div>
  );
}
