import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatNumber } from "../../lib/format";

export default function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (totalPages <= 1) return null;

  return (
    <nav
      className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4"
      aria-label="搜索结果分页"
    >
      <span className="text-[12px] text-[var(--muted-2)]">
        第 <span className="tabular-nums">{page}</span> /{" "}
        <span className="tabular-nums">{totalPages}</span> 页 · 共{" "}
        {formatNumber(total)} 条
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="上一页"
        >
          <ChevronLeft size={14} aria-hidden />
          上一页
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="下一页"
        >
          下一页
          <ChevronRight size={14} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
