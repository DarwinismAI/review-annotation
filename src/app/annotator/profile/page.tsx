"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DomainPicker } from "@/components/domain-picker";
import {
  DOMAIN_LABELS,
  subDomainForMedicalMicroDomain,
  type DomainKey,
  type MedicalMicroDomainKey,
  type SubDomainKey,
} from "@/lib/labels";

interface ProfileData {
  email: string;
  name: string | null;
  createdAt: string | number | null;
  domains: DomainKey[];
  sub_domains: SubDomainKey[];
  medical_micro_domains: MedicalMicroDomainKey[];
}

type AvailableMap = Record<DomainKey, SubDomainKey[]>;

function formatDate(raw: string | number | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ExpertProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [draft, setDraft] = useState<DomainKey[]>([]);
  const [draftSubs, setDraftSubs] = useState<SubDomainKey[]>([]);
  const [draftMedicalMicros, setDraftMedicalMicros] = useState<MedicalMicroDomainKey[]>([]);
  const [available, setAvailable] = useState<AvailableMap | null>(null);
  const [fetchErr, setFetchErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/annotator/profile")
      .then((r) => r.json())
      .then((json) => {
        if (json.data) {
          const data = json.data as ProfileData;
          setProfile(data);
          setDraft(data.domains);
          setDraftSubs(data.sub_domains ?? []);
          setDraftMedicalMicros(data.medical_micro_domains ?? []);
        }
      })
      .catch(() => setError("Không tải được hồ sơ"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sub-domains/available")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const data = json?.data as AvailableMap | undefined;
        if (!data) {
          setFetchErr(true);
          return;
        }
        setAvailable(data);
      })
      .catch(() => {
        if (!cancelled) setFetchErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Orphan cleanup runs once both profile and available are loaded, regardless
  // of which arrived first. We strip stale opt-ins (e.g. expert had trv_05 but
  // tourism re-seeded without it) so dirty-check and Save reflect real state.
  useEffect(() => {
    if (!available || !profile) return;
    const validDomains = (Object.keys(available) as DomainKey[]).filter(
      (d) => available[d].length > 0,
    );
    const allSubs = new Set<SubDomainKey>(Object.values(available).flat());
    setDraft((prev) => prev.filter((d) => validDomains.includes(d)));
    setDraftSubs((prev) => prev.filter((s) => allSubs.has(s)));
    setDraftMedicalMicros((prev) =>
      prev.filter((microId) => {
        const parent = subDomainForMedicalMicroDomain(microId);
        return parent ? allSubs.has(parent) : false;
      })
    );
  }, [available, profile]);

  const dirty =
    profile != null &&
    (draft.length !== profile.domains.length ||
      !draft.every((d) => profile.domains.includes(d)) ||
      draftSubs.length !== (profile.sub_domains ?? []).length ||
      !draftSubs.every((s) => (profile.sub_domains ?? []).includes(s)) ||
      draftMedicalMicros.length !== (profile.medical_micro_domains ?? []).length ||
      !draftMedicalMicros.every((s) => (profile.medical_micro_domains ?? []).includes(s)));

  async function handleSave() {
    if (!profile || draft.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/annotator/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domains: draft,
          sub_domains: draftSubs,
          medical_micro_domains: draftMedicalMicros,
        }),
      });
      const json = (await res.json()) as {
        error?: { message?: string };
        data?: {
          domains: DomainKey[];
          sub_domains: SubDomainKey[];
          medical_micro_domains: MedicalMicroDomainKey[];
        };
      };
      if (!res.ok) {
        setError(json.error?.message ?? "Không lưu được");
        return;
      }
      const nextDomains = json.data?.domains ?? draft;
      const nextSubs = json.data?.sub_domains ?? draftSubs;
      const nextMedicalMicros = json.data?.medical_micro_domains ?? draftMedicalMicros;
      setProfile({
        ...profile,
        domains: nextDomains,
        sub_domains: nextSubs,
        medical_micro_domains: nextMedicalMicros,
      });
      setDraftSubs(nextSubs);
      setDraftMedicalMicros(nextMedicalMicros);
      setToast("Đã cập nhật chuyên môn");
      window.setTimeout(() => setToast(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>

        <h1 className="text-2xl font-bold text-slate-900">Hồ sơ annotator</h1>

        {/* Account info card */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
            Thông tin cơ bản
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-slate-500 text-xs uppercase">Email</dt>
              <dd className="text-slate-900 font-medium mt-1">
                {profile?.email ?? "Đang tải..."}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs uppercase">Ngày tạo tài khoản</dt>
              <dd className="text-slate-900 font-medium mt-1">
                {profile ? formatDate(profile.createdAt) : "—"}
              </dd>
            </div>
          </dl>
        </section>

        {/* Domain card */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
                Lĩnh vực review
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Bạn nhận được bài broadcast và bài phân công thuộc lĩnh vực đã chọn (tối thiểu 1, tối đa 2).
              </p>
            </div>
          </div>

          {available === null && !fetchErr ? (
            <div className="space-y-2" aria-live="polite" aria-busy="true">
              <div className="h-16 w-full animate-pulse rounded-xl bg-slate-100" />
              <div className="h-16 w-full animate-pulse rounded-xl bg-slate-100" />
              <div className="h-16 w-full animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : (
            <DomainPicker
              domains={draft}
              onDomainsChange={setDraft}
              subDomains={draftSubs}
              onSubDomainsChange={setDraftSubs}
              medicalMicroDomains={draftMedicalMicros}
              onMedicalMicroDomainsChange={setDraftMedicalMicros}
              enforceMinOne
              availableSubDomains={available ?? undefined}
            />
          )}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-slate-500">
              {draft.length === 0
                ? "Chưa chọn lĩnh vực"
                : `Đã chọn: ${draft.map((d) => DOMAIN_LABELS[d]).join(", ")}`}
            </p>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving || draft.length === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {saving ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>
        </section>

        {/* Security info */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-2">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
            Bảo mật
          </h2>
          <p className="text-sm text-slate-600">
            Tài khoản dùng đăng nhập không mật khẩu — mỗi lần đăng nhập, hệ thống gửi mã 6 chữ số tới email.
            Phiên hiệu lực 30 ngày kể từ lần truy cập gần nhất.
          </p>
        </section>

      {toast ? (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-50 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{toast}</span>
        </div>
      ) : null}
    </>
  );
}
