import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, UserRound } from "lucide-react";
import type { SearchItem } from "../../lib/types";
import { formatDate, kindLabel } from "../../lib/format";
import Highlight from "./Highlight";

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

export default function DocumentCard({
  item,
  terms,
}: {
  item: SearchItem;
  terms: string[];
}) {
  const date = item.sourceCreatedAt || item.publishedAt;
  const host = hostOf(item.url);

  return (
    <Link
      to={`/library/${item.id}`}
      className="card card-hover group block px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <span className="chip chip-outline mt-0.5 shrink-0">
          {kindLabel(item.kind)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-6 text-[var(--ink)] transition group-hover:text-[var(--accent-strong)]">
            <Highlight text={item.title} terms={terms} />
          </h3>
          {item.snippet && (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-6 text-[var(--muted)]">
              <Highlight text={item.snippet} terms={terms} />
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-[var(--muted-2)]">
            <span className="chip chip-accent">{item.sourceName}</span>
            {date && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays size={12} aria-hidden />
                {formatDate(date)}
              </span>
            )}
            {item.author && (
              <span className="inline-flex max-w-[220px] items-center gap-1 truncate">
                <UserRound size={12} aria-hidden />
                <span className="truncate">{item.author}</span>
              </span>
            )}
            {host && <span className="max-w-[220px] truncate">{host}</span>}
            {item.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="chip">
                #{tag}
              </span>
            ))}
            {item.tags.length > 3 && <span>+{item.tags.length - 3}</span>}
          </div>
        </div>
        <ArrowUpRight
          size={15}
          className="mt-1 shrink-0 text-[var(--line-strong)] transition group-hover:text-[var(--accent)]"
          aria-hidden
        />
      </div>
    </Link>
  );
}
