import { Loader2 } from "lucide-react";

export default function Spinner({ label = "载入中…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-[13px] text-[var(--muted)]">
      <Loader2 size={18} className="spin" />
      {label}
    </div>
  );
}
