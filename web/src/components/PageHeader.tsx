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
    <div className="flex flex-col gap-4 border-b border-[var(--line)] px-6 py-7 sm:flex-row sm:items-end sm:justify-between lg:px-10 lg:py-9">
      <div>
        {eyebrow && (
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-[27px] font-semibold tracking-tight text-[var(--ink)] lg:text-[31px]">
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
