"use client";

import { useEffect, useState } from "react";
import {
  DOMAIN_LABELS,
  DOMAIN_ICONS,
  SUB_DOMAIN_LABELS,
  MEDICAL_MICRO_DOMAIN_LABELS,
  domainForSubDomain,
  type DomainKey,
  type MedicalMicroDomainKey,
  type SubDomainKey,
} from "@/lib/labels";

interface Expert {
  id: string;
  email: string;
  name: string;
  domain: string;
  domains: string[];
  sub_domains: string[];
  medical_micro_domains: string[];
  status: string;
  invitedAt: number | string | null;
  activatedAt: number | string | null;
  userId: string;
}

const STATUS_CFG: Record<string, { label: string; dot: string; badge: string }> = {
  active:   { label: "Đã kích hoạt",    dot: "bg-green-500", badge: "bg-green-100 text-green-700"  },
  pending:  { label: "Chờ kích hoạt",   dot: "bg-amber-500", badge: "bg-amber-100 text-amber-700"  },
  inactive: { label: "Ngừng hoạt động", dot: "bg-slate-400", badge: "bg-slate-100 text-slate-500"  },
};

const AVATAR_COLORS = [
  "bg-blue-500", "bg-amber-500", "bg-purple-500", "bg-pink-500",
  "bg-cyan-500",  "bg-green-500", "bg-indigo-500", "bg-rose-500",
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function avatarColor(idx: number): string {
  return AVATAR_COLORS[idx % AVATAR_COLORS.length];
}

function formatDate(raw: number | string | null): string {
  if (!raw) return "—";
  const d = new Date(typeof raw === "number" ? raw : raw);
  if (isNaN(d.getTime())) return "—";
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getFullYear()}`;
}

export default function AdminExpertsPage() {
  const [experts, setExperts] = useState<Expert[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusActionId, setStatusActionId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState("");

  // Invite dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteDomain, setInviteDomain] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");

  useEffect(() => {
    fetch("/api/experts")
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setExperts(json.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail || !inviteName || !inviteDomain) return;
    setInviting(true);
    setInviteError("");
    try {
      const res = await fetch("/api/experts/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, name: inviteName, domain: inviteDomain }),
      });
      const json = await res.json();
      if (!res.ok) {
        setInviteError(json.error?.message ?? "Gửi lời mời thất bại");
        return;
      }
      // Optimistically add to list
      setExperts((prev) => [
        ...prev,
        {
          id: json.data.id,
          email: inviteEmail,
          name: inviteName,
          domain: inviteDomain,
          domains: [inviteDomain],
          sub_domains: [],
          medical_micro_domains: [],
          status: "pending",
          invitedAt: Date.now(),
          activatedAt: null,
          userId: "",
        },
      ]);
      setDialogOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteDomain("");
    } catch {
      setInviteError("Đã xảy ra lỗi, vui lòng thử lại");
    } finally {
      setInviting(false);
    }
  }

  async function updateExpertStatus(expert: Expert, status: "active" | "inactive") {
    setStatusError("");
    setStatusActionId(expert.id);
    try {
      const res = await fetch(`/api/experts/${expert.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatusError(json.error?.message ?? "Không cập nhật được trạng thái chuyên gia");
        return;
      }
      setExperts((prev) =>
        prev.map((item) =>
          item.id === expert.id
            ? {
                ...item,
                ...json.data,
                domains: item.domains,
                sub_domains: item.sub_domains,
                medical_micro_domains: item.medical_micro_domains,
                userId: item.userId,
              }
            : item
        )
      );
    } catch {
      setStatusError("Đã xảy ra lỗi, vui lòng thử lại");
    } finally {
      setStatusActionId(null);
    }
  }

  return (
    <>
        {/* Title row */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Danh sách chuyên gia</h1>
          <button
            onClick={() => setDialogOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
          >
            + Mời chuyên gia
          </button>
        </div>

        {/* Table card */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {statusError ? (
            <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
              {statusError}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Email</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Tên</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Lĩnh vực</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Trạng thái</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Ngày mời</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Ngày kích hoạt</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center">
                      <p className="text-slate-500 text-sm">Đang tải...</p>
                    </td>
                  </tr>
                ) : experts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">
                      Chưa có chuyên gia nào.
                    </td>
                  </tr>
                ) : (
                  experts.map((ex, idx) => {
                    const sc = STATUS_CFG[ex.status] ?? STATUS_CFG.pending;
                    const color = avatarColor(idx);
                    const ini = initials(ex.name ?? ex.email ?? "?");
                    return (
                      <tr key={ex.id} className="hover:bg-blue-50/50 transition-colors">
                        <td className="px-5 py-3.5 text-slate-600">{ex.email}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 ${color} rounded-full flex items-center justify-center flex-shrink-0`}>
                              <span className="text-[10px] font-bold text-white">{ini}</span>
                            </div>
                            <span className="font-medium text-slate-900">{ex.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <DomainSubDomainCell
                            domains={ex.domains?.length ? ex.domains : ex.domain ? [ex.domain] : []}
                            subDomains={ex.sub_domains ?? []}
                            medicalMicroDomains={ex.medical_micro_domains ?? []}
                          />
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${sc.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                            {sc.label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">{formatDate(ex.invitedAt)}</td>
                        <td className="px-5 py-3.5 text-slate-600">{formatDate(ex.activatedAt)}</td>
                        <td className="px-5 py-3.5 text-center">
                          {ex.status === "active" && (
                            <button
                              type="button"
                              onClick={() => updateExpertStatus(ex, "inactive")}
                              disabled={statusActionId === ex.id}
                              className="border border-slate-200 bg-white text-slate-500 hover:border-red-300 hover:text-red-500 rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-60"
                            >
                              {statusActionId === ex.id ? "Đang cập nhật..." : "Vô hiệu hóa"}
                            </button>
                          )}
                          {ex.status === "inactive" && (
                            <button
                              type="button"
                              onClick={() => updateExpertStatus(ex, "active")}
                              disabled={statusActionId === ex.id}
                              className="border border-slate-200 bg-white text-slate-500 hover:border-green-300 hover:text-green-600 rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-60"
                            >
                              {statusActionId === ex.id ? "Đang cập nhật..." : "Kích hoạt lại"}
                            </button>
                          )}
                          {ex.status === "pending" && (
                            <button className="border border-slate-200 bg-white text-slate-500 hover:border-blue-300 rounded-lg px-3 py-1.5 text-xs transition-colors">
                              Gửi lại
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      {/* Invite dialog */}
      {dialogOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setDialogOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">Mời chuyên gia</h2>
              <button
                onClick={() => setDialogOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleInvite} noValidate className="space-y-4">
              {/* Email */}
              <div>
                <label htmlFor="invite-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Email
                </label>
                <input
                  id="invite-email"
                  type="email"
                  placeholder="expert@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
                />
              </div>
              {/* Tên */}
              <div>
                <label htmlFor="invite-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Tên đầy đủ
                </label>
                <input
                  id="invite-name"
                  type="text"
                  placeholder="Nguyễn Văn A"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
                />
              </div>
              {/* Lĩnh vực */}
              <div>
                <label htmlFor="invite-domain" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Lĩnh vực
                </label>
                <select
                  id="invite-domain"
                  value={inviteDomain}
                  onChange={(e) => setInviteDomain(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition bg-white"
                >
                  <option value="">Chọn lĩnh vực…</option>
                  <option value="law">Pháp luật</option>
                  <option value="medical">Y tế</option>
                  <option value="tourism">Du lịch</option>
                </select>
              </div>

              {inviteError && (
                <p className="text-sm text-red-600">{inviteError}</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="border border-slate-200 bg-white text-slate-600 hover:border-blue-300 rounded-lg px-4 py-2 text-sm transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {inviting ? "Đang gửi…" : "Gửi lời mời"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Two-line summary: top row lists main domains with icons; bottom row lists chosen
 * sub-domains grouped by parent (max 3 visible; remainder collapsed into "+N" with
 * the full list shown on hover via a native title tooltip).
 */
function DomainSubDomainCell({
  domains,
  subDomains,
  medicalMicroDomains,
}: {
  domains: string[];
  subDomains: string[];
  medicalMicroDomains: string[];
}) {
  const validDomains = domains.filter((d): d is DomainKey => d in DOMAIN_LABELS);
  const validSubs = subDomains.filter((s): s is SubDomainKey => s in SUB_DOMAIN_LABELS);
  const validMedicalMicros = medicalMicroDomains.filter(
    (s): s is MedicalMicroDomainKey => s in MEDICAL_MICRO_DOMAIN_LABELS
  );

  if (validDomains.length === 0) {
    return <span className="text-slate-400 text-xs">—</span>;
  }

  const MAX_VISIBLE = 3;
  const visibleSubs = validSubs.slice(0, MAX_VISIBLE);
  const remainingCount = validSubs.length - visibleSubs.length;
  const remainingNames = validSubs
    .slice(MAX_VISIBLE)
    .map((s) => SUB_DOMAIN_LABELS[s])
    .join(", ");

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {validDomains.map((d) => (
          <span
            key={d}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700"
          >
            <span aria-hidden>{DOMAIN_ICONS[d]}</span>
            {DOMAIN_LABELS[d]}
          </span>
        ))}
      </div>
      {validSubs.length === 0 ? (
        <p className="text-[11px] text-slate-400">Tất cả chuyên ngành</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {visibleSubs.map((s) => {
            const parent = domainForSubDomain(s);
            return (
              <span
                key={s}
                className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-100"
                title={parent ? `${DOMAIN_LABELS[parent]} · ${SUB_DOMAIN_LABELS[s]}` : SUB_DOMAIN_LABELS[s]}
              >
                {SUB_DOMAIN_LABELS[s]}
              </span>
            );
          })}
          {remainingCount > 0 ? (
            <span
              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600"
              title={remainingNames}
            >
              +{remainingCount}
            </span>
          ) : null}
        </div>
      )}
      {validMedicalMicros.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {validMedicalMicros.slice(0, MAX_VISIBLE).map((microId) => (
            <span
              key={microId}
              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-100"
              title={MEDICAL_MICRO_DOMAIN_LABELS[microId]}
            >
              {MEDICAL_MICRO_DOMAIN_LABELS[microId]}
            </span>
          ))}
          {validMedicalMicros.length > MAX_VISIBLE ? (
            <span
              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600"
              title={validMedicalMicros.slice(MAX_VISIBLE).map((s) => MEDICAL_MICRO_DOMAIN_LABELS[s]).join(", ")}
            >
              +{validMedicalMicros.length - MAX_VISIBLE}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
