import type { LucideIcon } from "lucide-react";

type Tone = "accent" | "teal" | "ink" | "clay";

const toneClasses: Record<Tone, string> = {
  accent: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
  teal: "bg-[#e6efed] text-[var(--teal)]",
  ink: "bg-[#e9e7e1] text-[var(--ink-3)]",
  clay: "bg-[#f4e7e3] text-[#a2644f]",
};

export default function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "accent",
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone?: Tone;
}) {
  return (
    <div className="card card-hover flex flex-col justify-between gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="pt-1 text-[12px] font-medium tracking-wide text-[var(--muted)]">
          {label}
        </span>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClasses[tone]}`}
          aria-hidden
        >
          <Icon size={15} strokeWidth={1.8} />
        </span>
      </div>
      <div>
        <div className="font-display text-[29px] font-semibold leading-none tracking-tight text-[var(--ink)]">
          {value}
        </div>
        <div className="mt-2 text-[11.5px] leading-5 text-[var(--muted-2)]">{hint}</div>
      </div>
    </div>
  );
}
