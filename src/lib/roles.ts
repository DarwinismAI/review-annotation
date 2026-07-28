export const APP_ROLES = ["superadmin", "admin", "annotator"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export function normalizeRole(role: unknown): AppRole | null {
  if (role === "expert") return "annotator";
  return typeof role === "string" && (APP_ROLES as readonly string[]).includes(role)
    ? (role as AppRole)
    : null;
}

export function isBootstrapSuperAdminEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const allowlist = (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}

export function resolveEffectiveRole(role: unknown, email?: unknown): AppRole {
  if (isBootstrapSuperAdminEmail(email)) return "superadmin";
  return normalizeRole(role) ?? "annotator";
}

export function isAdminRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === "superadmin" || normalized === "admin";
}

export function isSuperAdminRole(role: unknown): boolean {
  return normalizeRole(role) === "superadmin";
}

export function isAnnotatorRole(role: unknown): boolean {
  return normalizeRole(role) === "annotator";
}
