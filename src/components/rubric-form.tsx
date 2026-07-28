"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DOMAIN_KEYS, labelForDomain } from "@/lib/labels";

interface ScaleItem {
  score: number;
  label: string;
  description: string;
}

interface RubricFormProps {
  initialData?: {
    id: string;
    name: string;
    domain: string;
    description: string;
    required: boolean;
    scale: ScaleItem[];
  };
}

const DEFAULT_SCALE: ScaleItem[] = [
  { score: 1, label: "Failed", description: "Không đạt metric này." },
  { score: 2, label: "Pass", description: "Đạt metric này." },
];

export default function RubricForm({ initialData }: RubricFormProps) {
  const router = useRouter();
  const isEdit = Boolean(initialData);

  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [domain, setDomain] = useState(initialData?.domain ?? "safety_compliance");
  const [required, setRequired] = useState(initialData?.required ?? true);
  const [scale, setScale] = useState<ScaleItem[]>(initialData?.scale?.length ? initialData.scale : DEFAULT_SCALE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }

  function updateScale(index: number, patch: Partial<ScaleItem>) {
    setScale((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function addScaleItem() {
    setScale((current) => [
      ...current,
      {
        score: current.length + 1,
        label: `Mức ${current.length + 1}`,
        description: "",
      },
    ]);
  }

  function removeScaleItem(index: number) {
    setScale((current) => current.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, score: itemIndex + 1 })));
  }

  async function handleSave() {
    setError("");
    if (!name.trim()) {
      setError("Tên metric là bắt buộc");
      document.getElementById("metric-name")?.focus();
      return;
    }
    if (!domain) {
      setError("Metric phải gắn với một lĩnh vực");
      return;
    }
    if (scale.length < 2 || scale.some((item) => !item.label.trim() || !item.description.trim())) {
      setError("Scale cần ít nhất 2 mức, mỗi mức có label và mô tả");
      return;
    }

    const normalizedScale = scale.map((item, index) => ({
      score: index + 1,
      label: item.label.trim(),
      description: item.description.trim(),
    }));
    const payload = {
      name: name.trim(),
      domain,
      description: description.trim(),
      required,
      scale: normalizedScale,
    };

    setSaving(true);
    try {
      const res = await fetch(isEdit && initialData ? `/api/rubrics/${initialData.id}` : "/api/rubrics", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: { message?: string } }).error?.message ?? "Lỗi lưu metric");
        return;
      }

      showToast("Đã lưu metric.");
      setTimeout(() => router.push("/admin/rubrics"), 800);
    } catch {
      setError("Đã xảy ra lỗi, vui lòng thử lại");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Thông tin metric</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="metric-name">
              Tên metric
            </label>
            <input
              id="metric-name"
              type="text"
              placeholder="Ví dụ: Vi phạm chính sách"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder-slate-400 focus:border-blue-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="metric-domain">
              Lĩnh vực
            </label>
            <select
              id="metric-domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-blue-400"
            >
              {DOMAIN_KEYS.map((key) => (
                <option key={key} value={key}>
                  {labelForDomain(key)}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-3 pt-7 text-sm text-slate-700">
            <input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />
            Bắt buộc chấm
          </label>

          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="metric-description">
              Mô tả / guideline
            </label>
            <textarea
              id="metric-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Mô tả metric và cách annotator cần đánh giá."
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder-slate-400 focus:border-blue-400"
            />
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">Thông số chấm</h2>
          <button
            type="button"
            onClick={addScaleItem}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition-colors hover:border-blue-300"
          >
            Thêm mức
          </button>
        </div>

        <div className="space-y-3">
          {scale.map((item, index) => (
            <div key={index} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[96px_180px_1fr_auto]">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-slate-400">Score</label>
                <input
                  type="number"
                  value={index + 1}
                  disabled
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-slate-400">Label</label>
                <input
                  type="text"
                  value={item.label}
                  onChange={(event) => updateScale(index, { label: event.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-slate-400">Mô tả</label>
                <input
                  type="text"
                  value={item.description}
                  onChange={(event) => updateScale(index, { description: event.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
                />
              </div>
              <button
                type="button"
                onClick={() => removeScaleItem(index)}
                disabled={scale.length <= 2}
                className="self-end rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-red-500 transition-colors hover:border-red-300 disabled:opacity-40"
              >
                Xóa
              </button>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="flex items-center justify-end gap-3 pb-12">
        <a href="/admin/rubrics" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition-colors hover:border-blue-300">
          Hủy
        </a>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "Đang lưu..." : "Lưu metric"}
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
