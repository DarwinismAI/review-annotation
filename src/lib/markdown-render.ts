/**
 * Shared markdown → HTML renderer for the review surfaces.
 *
 * Used by both the expert review page (`/review/[id]`) and the admin preview
 * page (`/admin/articles/[id]/preview`) so they render article section content
 * identically — headings, lists, tables, inline emphasis, and [src_xxx]
 * citation tokens with hover tooltips.
 *
 * Output is intended for `dangerouslySetInnerHTML`. All user-supplied strings
 * are HTML-escaped before any markdown transform is applied.
 */

export interface SourceItem {
  source_id: string;
  title?: string;
  publisher?: string;
  url?: string;
}

// HTML-escape user-supplied strings before embedding in dangerouslySetInnerHTML.
export function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Inline markdown: **bold**, *italic*, `code`. Operates on already-escaped HTML.
export function renderInline(text: string): string {
  return escHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, '<code class="bg-slate-100 px-1 rounded text-[0.9em]">$1</code>');
}

function parseTableRow(line: string): string[] {
  const parts = line.split("|").map((s) => s.trim());
  if (parts[0] === "") parts.shift();
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Build a stable source-id → number map from `sources[]` order. Used by both
 * `renderSectionHtml` (for [src_xxx] tokens) and the claim source pills, so
 * "src_sup_003" gets the same display number `[4]` everywhere.
 */
export function buildSourceNumberMap(sources: SourceItem[]): Map<string, number> {
  const map = new Map<string, number>();
  sources.forEach((s, i) => map.set(s.source_id, i + 1));
  return map;
}

/**
 * Convert section content (markdown) to HTML, with inline citations.
 * Supports headings (## ###), bold, italic, code, ordered/unordered lists,
 * tables (markdown pipe syntax), and paragraph breaks. After block-level
 * markdown is rendered, [src_xxx] tokens are replaced with hover-tooltip pills.
 */
export function renderSectionHtml(content: string, sources: SourceItem[]): string {
  const sourceMap = new Map<string, SourceItem>();
  sources.forEach((s) => sourceMap.set(s.source_id, s));
  const numberMap = buildSourceNumberMap(sources);

  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Heading: ## … through ###### …
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls =
        level <= 2
          ? "text-lg font-bold text-slate-900 mt-6 mb-2"
          : level === 3
          ? "text-base font-bold text-slate-900 mt-5 mb-2"
          : "text-sm font-semibold text-slate-800 mt-4 mb-1";
      const tag = `h${Math.min(Math.max(level + 1, 3), 6)}`;
      out.push(`<${tag} class="${cls}">${renderInline(h[2])}</${tag}>`);
      i++;
      continue;
    }

    // Markdown table
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*[-:]+/.test(lines[i + 1])) {
      const headers = parseTableRow(line);
      const numCols = headers.length;
      i += 2;
      let t = "<table><thead><tr>" + headers.map((c) => `<th>${renderInline(c)}</th>`).join("") + "</tr></thead><tbody>";
      while (i < lines.length && lines[i].includes("|")) {
        const cells = parseTableRow(lines[i]);
        const padded = Array.from({ length: numCols }, (_, idx) => cells[idx] ?? "");
        t += "<tr>" + padded.map((c) => `<td>${renderInline(c)}</td>`).join("") + "</tr>";
        i++;
      }
      out.push(t + "</tbody></table>");
      continue;
    }

    // Blockquote: collect consecutive `>` lines
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(
        `<blockquote class="border-l-4 border-amber-300 bg-amber-50 pl-3 pr-2 py-2 my-3 text-slate-700">${quoteLines
          .map(renderInline)
          .join("<br/>")}</blockquote>`
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul class="list-disc pl-5 my-2 space-y-1">${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol class="list-decimal pl-5 my-2 space-y-1">${items.join("")}</ol>`);
      continue;
    }

    // Paragraph: collect consecutive non-empty, non-block-start lines
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|\s*>\s?|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p class="my-3">${para.map(renderInline).join("<br/>")}</p>`);
  }

  let html = out.join("");

  // Replace [src_xxx] / [src_xxx, src_yyy] tokens with citation pills
  html = html.replace(
    /\[((?:src_[a-z0-9_]+)(?:,\s*src_[a-z0-9_]+)*)\]/g,
    (_match, inner: string) => {
      return inner
        .split(",")
        .map((s) => s.trim())
        .map((id) => {
          const num = numberMap.get(id) ?? "?";
          const src = sourceMap.get(id);
          if (!src) {
            return `<span class="src-pill"><sup class="text-[11px] text-blue-600 font-bold ml-0.5">[${num}]</sup></span>`;
          }
          const title = escHtml(src.title ?? id);
          const publisher = escHtml(src.publisher ?? "");
          const url = src.url ? escHtml(src.url) : "";
          const urlHtml = url
            ? `<a href="${url}" target="_blank" rel="noopener" class="underline break-all" style="color:#93c5fd">${url}</a>`
            : "";
          return `<span class="src-pill"><sup class="text-[11px] text-blue-600 font-bold cursor-pointer hover:text-blue-800 ml-0.5">[${num}]</sup><span class="tooltip"><strong>${title}</strong><br/><span style="color:#94a3b8">${publisher}</span><br/>${urlHtml}</span></span>`;
        })
        .join("");
    }
  );

  return html;
}
