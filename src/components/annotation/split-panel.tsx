"use client";

interface Source {
  source_id: string;
  title: string;
  publisher: string;
  url: string;
}

interface SplitPanelProps {
  sectionIndex: number;
  totalSections: number;
  heading: string;
  content: string;
  isDone: boolean;
  sources: Source[];
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSourceMap(sources: Source[]): Record<string, Source> {
  return Object.fromEntries(sources.map((s) => [s.source_id, s]));
}

function buildSourceNumberMap(sections: { content: string }[]): Record<string, number> {
  const numberMap: Record<string, number> = {};
  let counter = 1;
  for (const sec of sections) {
    const matches = (sec.content || "").matchAll(
      /\[((src_[a-z0-9_]+)(,\s*src_[a-z0-9_]+)*)\]/g
    );
    for (const m of matches) {
      m[1]
        .split(",")
        .map((s) => s.trim())
        .forEach((id) => {
          if (!(id in numberMap)) numberMap[id] = counter++;
        });
    }
  }
  return numberMap;
}

/** Parse markdown pipe tables into HTML. */
function convertMarkdownTable(text: string): string {
  const lines = text.split("\n");
  let result = "";
  let i = 0;

  while (i < lines.length) {
    if (
      lines[i].includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*[-:]+/.test(lines[i + 1])
    ) {
      const headers = lines[i]
        .split("|")
        .map((s) => s.trim())
        .filter((s, idx, arr) => idx > 0 && idx < arr.length - 1);
      const numCols = headers.length;
      i += 2;
      let t =
        "<table><thead><tr>" +
        headers.map((h) => `<th>${escHtml(h)}</th>`).join("") +
        "</tr></thead><tbody>";
      while (i < lines.length && lines[i].includes("|")) {
        const parts = lines[i].split("|");
        if (parts[0].trim() === "") parts.shift();
        const cells: string[] = [];
        for (let c = 0; c < numCols; c++) {
          if (c < numCols - 1) {
            cells.push(parts[c] ? parts[c].trim() : "");
          } else {
            cells.push(
              parts
                .slice(c)
                .map((s) => s.trim())
                .filter(Boolean)
                .join(" ")
            );
          }
        }
        t += "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>";
        i++;
      }
      result += t + "</tbody></table>";
    } else {
      result += lines[i] + "\n";
      i++;
    }
  }
  return result;
}

/** Render article content: replace [src_*] citations with superscript tooltips. */
function renderContent(
  text: string,
  sourceMap: Record<string, Source>,
  sourceNumberMap: Record<string, number>
): string {
  let html = convertMarkdownTable(text);

  html = html.replace(
    /\[((src_[a-z0-9_]+)(,\s*src_[a-z0-9_]+)*)\]/g,
    (_match, inner: string) => {
      return inner
        .split(",")
        .map((s) => s.trim())
        .map((id) => {
          const src = sourceMap[id];
          const num = sourceNumberMap[id] ?? id;
          if (!src) {
            return `<span class="src-pill"><sup class="text-[11px] text-blue-600 font-bold ml-0.5">[${num}]</sup></span>`;
          }
          return `<span class="src-pill">
            <sup class="text-[11px] text-blue-600 font-bold cursor-pointer hover:text-blue-800 ml-0.5">[${num}]</sup>
            <span class="tooltip">
              <strong>${escHtml(src.title)}</strong><br/>
              <span style="color:#94a3b8">${escHtml(src.publisher)}</span><br/>
              <a href="${escHtml(src.url)}" class="underline break-all" style="color:#93c5fd">${escHtml(src.url)}</a>
            </span>
          </span>`;
        })
        .join("");
    }
  );

  html = html.replace(/\n(?!<)/g, "<br/>");
  return html;
}

export function SplitPanelLeft({
  sectionIndex,
  totalSections,
  heading,
  content,
  isDone,
  sources,
}: SplitPanelProps) {
  const sourceMap = buildSourceMap(sources);
  // For source numbering we only have the current section content here,
  // but we still pass a single-section array for ordering.
  const sourceNumberMap = buildSourceNumberMap([{ content }]);
  const renderedContent = renderContent(content, sourceMap, sourceNumberMap);

  return (
    <div id="left-panel" className="w-3/5 overflow-y-auto bg-white border-r border-slate-200 p-6">
      <div className="max-w-[65ch]">
        <div className="flex items-center justify-between mb-4">
          <span
            id="section-label"
            className="text-xs font-semibold text-blue-600 uppercase tracking-wider"
          >
            Phần {sectionIndex + 1} / {totalSections}
          </span>
          <span id="section-status" className="text-xs">
            {isDone ? (
              <span className="inline-flex items-center gap-1 text-green-600 font-medium text-xs">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Đã chấm
              </span>
            ) : (
              <span className="text-slate-400 text-xs">Chưa chấm</span>
            )}
          </span>
        </div>

        <h2
          id="section-heading"
          className="text-xl font-bold text-slate-900 mb-4 leading-snug"
        >
          {heading}
        </h2>

        <div
          id="section-content"
          className="content-text text-[15px] text-slate-700 leading-7"
          dangerouslySetInnerHTML={{ __html: renderedContent }}
        />
      </div>
    </div>
  );
}
