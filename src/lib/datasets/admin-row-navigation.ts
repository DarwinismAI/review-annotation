export type CompletionFilter = "all" | "completed" | "complete" | "incomplete";

interface RowHrefInput {
  datasetId: string;
  rowId: string;
  from: string;
  search: string;
  completion: CompletionFilter;
}

export function isTextInputTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  const tagName = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tagName === "TEXTAREA" || tagName === "SELECT") return true;
  if (tagName !== "INPUT") return false;
  const type = typeof element.type === "string" ? element.type.toLowerCase() : "text";
  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
}

export function buildAdminRowHref({
  datasetId,
  rowId,
  from,
  search,
  completion,
}: RowHrefInput): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (search) params.set("search", search);
  if (completion !== "all") params.set("completion", completion);
  const query = params.toString();
  return `/admin/datasets/${datasetId}/rows/${rowId}${query ? `?${query}` : ""}`;
}

export function confirmDirtyNavigation(isDirty: boolean, confirm: () => boolean): boolean {
  return !isDirty || confirm();
}
