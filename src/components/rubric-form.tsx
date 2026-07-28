"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface ScaleItem {
  score: number;
  label: string;
  description: string;
}

interface Criterion {
  id: string;
  name: string;
  description: string;
  required: boolean;
  /** 5 scale items, one per level */
  levels: string[];
}

interface RubricFormProps {
  /** undefined = create mode; defined = edit mode */
  initialData?: {
    id: string;
    name: string;
    domain: string;
    criteria: {
      id: string;
      name: string;
      description: string;
      required: boolean;
      scale: ScaleItem[];
    }[];
  };
}

function newCriterion(tempId: string): Criterion {
  return {
    id: tempId,
    name: "",
    description: "",
    required: false,
    levels: ["", "", "", "", ""],
  };
}

function scaleToCriterion(c: {
  id: string;
  name: string;
  description: string;
  required: boolean;
  scale: ScaleItem[];
}): Criterion {
  const levels = Array.from({ length: 5 }, (_, i) => c.scale[i]?.description ?? "");
  return { id: c.id, name: c.name, description: c.description, required: c.required, levels };
}

export default function RubricForm({ initialData }: RubricFormProps) {
  const router = useRouter();
  const isEdit = !!initialData;

  const [name, setName] = useState(initialData?.name ?? "");
  const [domain, setDomain] = useState(initialData?.domain ?? "");
  const [criteria, setCriteria] = useState<Criterion[]>(
    initialData?.criteria.map(scaleToCriterion) ?? []
  );
  const [tempIdCounter, setTempIdCounter] = useState(100);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function addCriterion() {
    const id = `new-${tempIdCounter}`;
    setTempIdCounter((n) => n + 1);
    setCriteria((prev) => [...prev, newCriterion(id)]);
  }

  function removeCriterion(id: string) {
    setCriteria((prev) => prev.filter((c) => c.id !== id));
  }

  function updateCriterionField(id: string, field: "name" | "description", value: string) {
    setCriteria((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  }

  function updateLevel(id: string, levelIdx: number, value: string) {
    setCriteria((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const levels = [...c.levels];
        levels[levelIdx] = value;
        return { ...c, levels };
      })
    );
  }

  function toggleRequired(id: string) {
    setCriteria((prev) =>
      prev.map((c) => (c.id === id ? { ...c, required: !c.required } : c))
    );
  }

  async function handleSave() {
    if (!name.trim()) {
      setNameError(true);
      document.getElementById("rubric-name")?.focus();
      return;
    }
    setNameError(false);

    const payload = {
      name: name.trim(),
      domain,
      criteria: criteria.map((c, idx) => ({
        name: c.name,
        description: c.description,
        required: c.required,
        scale: c.levels.map((desc, i) => ({
          score: i + 1,
          label: String(i + 1),
          description: desc,
        })),
      })),
    };

    setSaving(true);
    try {
      let res: Response;
      if (isEdit && initialData) {
        res = await fetch(`/api/rubrics/${initialData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/rubrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast((err as { error?: { message?: string } }).error?.message ?? "Lỗi lưu rubric");
        return;
      }

      showToast("Đã lưu rubric thành công.");
      setTimeout(() => router.push("/admin/rubrics"), 1800);
    } catch {
      showToast("Đã xảy ra lỗi, vui lòng thử lại");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Section 1: Thông tin chung */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Thông tin chung</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              className="block text-sm font-medium text-slate-700 mb-1.5"
              htmlFor="rubric-name"
            >
              Tên rubric
            </label>
            <input
              id="rubric-name"
              type="text"
              placeholder="Nhập tên rubric…"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(false);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-400 focus:ring-0 outline-none transition-colors ${nameError ? "border-red-400" : "border-slate-200"}`}
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium text-slate-700 mb-1.5"
              htmlFor="rubric-domain"
            >
              Lĩnh vực
            </label>
            <select
              id="rubric-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 outline-none transition-colors bg-white"
            >
              <option value="">-- Chọn lĩnh vực --</option>
              <option value="law">Pháp luật</option>
              <option value="medical">Y tế</option>
              <option value="tourism">Du lịch</option>
            </select>
          </div>
        </div>
      </div>

      {/* Section 2: Tiêu chí chấm */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">Tiêu chí chấm</h2>
          <button
            onClick={addCriterion}
            className="inline-flex items-center gap-1.5 border border-slate-200 bg-white text-slate-600 hover:border-blue-300 rounded-lg px-3 py-2 text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Thêm tiêu chí
          </button>
        </div>

        {criteria.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400">
            Chưa có tiêu chí nào. Nhấn &ldquo;Thêm tiêu chí&rdquo; để bắt đầu.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {criteria.map((c, idx) => (
              <div
                key={c.id}
                id={`criterion-card-${c.id}`}
                className="rounded-xl border border-slate-200 p-5 relative"
              >
                {/* Card header */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                    Tiêu chí {idx + 1}
                  </span>
                  <button
                    onClick={() => removeCriterion(c.id)}
                    className="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0"
                    title="Xóa tiêu chí"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                {/* Tên + Mô tả */}
                <div className="flex flex-col gap-3 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Tên tiêu chí
                    </label>
                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) => updateCriterionField(c.id, "name", e.target.value)}
                      placeholder="Ví dụ: Tính chính xác…"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-400 outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Mô tả</label>
                    <textarea
                      rows={2}
                      value={c.description}
                      onChange={(e) => updateCriterionField(c.id, "description", e.target.value)}
                      placeholder="Mô tả ngắn về tiêu chí này…"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-400 outline-none transition-colors resize-none"
                    />
                  </div>
                </div>

                {/* Bắt buộc toggle */}
                <div className="flex items-center gap-3 mb-5">
                  <button
                    role="switch"
                    aria-checked={c.required}
                    onClick={() => toggleRequired(c.id)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full flex-shrink-0 transition-colors ${c.required ? "bg-blue-600" : "bg-slate-200"}`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${c.required ? "translate-x-4" : "translate-x-1"}`}
                    />
                  </button>
                  <span className="text-sm text-slate-700">Bắt buộc</span>
                </div>

                {/* Scale levels 1–5 */}
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">
                    Mức thang điểm (1 → 5)
                  </p>
                  <div className="flex flex-col gap-2">
                    {c.levels.map((lvl, li) => (
                      <div key={li} className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold flex items-center justify-center mt-1.5">
                          {li + 1}
                        </span>
                        <input
                          type="text"
                          value={lvl}
                          onChange={(e) => updateLevel(c.id, li, e.target.value)}
                          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-400 outline-none transition-colors"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="flex items-center justify-end gap-3 pb-12">
        <a
          href="/admin/rubrics"
          className="border border-slate-200 bg-white text-slate-600 hover:border-blue-300 rounded-lg px-3 py-2 text-sm transition-colors"
        >
          Hủy
        </a>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
        >
          {saving ? "Đang lưu..." : "Lưu rubric"}
        </button>
      </div>

      {/* Save success toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-green-600 text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg">
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          {toast}
        </div>
      )}
    </>
  );
}
