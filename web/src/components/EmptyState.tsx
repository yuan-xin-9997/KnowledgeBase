import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
        <Icon size={22} className="text-[var(--accent-strong)]" strokeWidth={1.6} />
      </div>
      <h3 className="font-display text-lg font-semibold text-[var(--ink)]">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-[13px] leading-6 text-[var(--muted)]">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
