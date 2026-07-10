import type { ReactNode } from "react";

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      <div className="w-11 h-11 rounded-lg border border-line bg-surfaceHi flex items-center justify-center text-inkMute mb-4">
        {icon}
      </div>
      <h3 className="text-[15px] font-medium text-ink">{title}</h3>
      {description && (
        <p className="text-sm text-inkMute mt-1.5 max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
