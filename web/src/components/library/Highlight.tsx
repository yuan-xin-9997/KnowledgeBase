import { highlightText } from "../../lib/format";

/**
 * Highlight search terms inside a piece of plain text.
 *
 * `highlightText` splits the text on the query terms, so every captured part is
 * either a term or ordinary copy. We derive the match flag from that split
 * instead of the helper's own flag (which is stateful for global regexes).
 */
export default function Highlight({
  text,
  terms,
  className,
}: {
  text: string;
  terms: string[];
  className?: string;
}) {
  const parts = highlightText(text, terms);
  const lowered = new Set(terms.filter(Boolean).map((term) => term.toLowerCase()));

  return (
    <span className={className}>
      {parts.map((part, index) =>
        lowered.has(part.text.toLowerCase()) ? (
          <mark key={`${index}-${part.text}`}>{part.text}</mark>
        ) : (
          <span key={`${index}-${part.text}`}>{part.text}</span>
        ),
      )}
    </span>
  );
}
