"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { DomainPicker } from "@/components/domain-picker";
import { subDomainForMedicalMicroDomain, type DomainKey, type MedicalMicroDomainKey, type SubDomainKey } from "@/lib/labels";

type AvailableMap = Record<DomainKey, SubDomainKey[]>;

export default function SignupProfilePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domains, setDomains] = useState<DomainKey[]>([]);
  const [subDomains, setSubDomains] = useState<SubDomainKey[]>([]);
  const [medicalMicroDomains, setMedicalMicroDomains] = useState<MedicalMicroDomainKey[]>([]);
  const [available, setAvailable] = useState<AvailableMap | null>(null);
  const [fetchErr, setFetchErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
        // Cleanup orphan selections — should normally be empty on fresh signup
        // but defensive in case state survived a remount.
        const validDomains = (Object.keys(data) as DomainKey[]).filter(
          (d) => data[d].length > 0,
        );
        const allSubs = new Set<SubDomainKey>(Object.values(data).flat());
        setDomains((prev) => prev.filter((d) => validDomains.includes(d)));
        setSubDomains((prev) => prev.filter((s) => allSubs.has(s)));
        setMedicalMicroDomains((prev) =>
          prev.filter((microId) => {
            const parent = subDomainForMedicalMicroDomain(microId);
            return parent ? allSubs.has(parent) : false;
          })
        );
      })
      .catch(() => {
        if (!cancelled) setFetchErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleComplete() {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError("Vui lòng nhập họ tên (ít nhất 2 ký tự)");
      return;
    }
    if (domains.length === 0) {
      setError("Vui lòng chọn ít nhất 1 chuyên môn");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/expert/profile/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          domains,
          sub_domains: subDomains,
          medical_micro_domains: medicalMicroDomains,
        }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        setError(json.error?.message ?? "Không lưu được hồ sơ");
        return;
      }
      router.push("/expert");
    } catch {
      setError("Đã xảy ra lỗi, vui lòng thử lại");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      brandTagline="Đăng ký chuyên gia"
      brandDescription="Nhập họ tên và chọn lĩnh vực bạn muốn review. Có thể sửa lại trong Hồ sơ chuyên gia bất kỳ lúc nào."
      progress={{ active: 1, total: 2 }}
      title="Bước 2 — Hồ sơ"
      subtitle="Nhập họ tên và chọn 1-2 lĩnh vực để hoàn tất đăng ký."
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1.5">
            Họ và tên
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="Nguyễn Văn A"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg placeholder-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 outline-none transition"
          />
        </div>

        {available === null && !fetchErr ? (
          <div className="space-y-2" aria-live="polite" aria-busy="true">
            <div className="h-16 w-full animate-pulse rounded-xl bg-slate-100" />
            <div className="h-16 w-full animate-pulse rounded-xl bg-slate-100" />
            <div className="h-16 w-full animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : (
          <DomainPicker
            domains={domains}
            onDomainsChange={setDomains}
            subDomains={subDomains}
            onSubDomainsChange={setSubDomains}
            medicalMicroDomains={medicalMicroDomains}
            onMedicalMicroDomainsChange={setMedicalMicroDomains}
            enforceMinOne={false}
            availableSubDomains={available ?? undefined}
          />
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          onClick={handleComplete}
          disabled={loading || domains.length === 0 || name.trim().length < 2}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
        >
          {loading ? "Đang hoàn tất..." : "Hoàn tất đăng ký"}
        </button>

        <p className="text-center text-xs text-slate-500">
          Tài khoản kích hoạt ngay khi bạn hoàn tất — không cần admin duyệt.
        </p>
      </div>
    </AuthShell>
  );
}
