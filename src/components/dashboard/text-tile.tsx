import { useMemo } from "react";
import { renderMarkdown } from "@/lib/markdown";

export function TextTile({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      dir="auto"
      className="markdown size-full overflow-auto [&>*:first-child]:mt-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
