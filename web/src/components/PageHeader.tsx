import type { ReactNode } from "react";

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--line)] bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-7">
      <div>
        {eyebrow && <span className="sr-only">{eyebrow}</span>}
        <h1 className="text-[21px] font-semibold tracking-tight text-[var(--ink)]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-6 text-[var(--muted)]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
