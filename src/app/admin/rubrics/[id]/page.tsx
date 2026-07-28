"use client";

import { use, useEffect, useState } from "react";
import RubricForm from "@/components/rubric-form";

interface ScaleItem {
  score: number;
  label: string;
  description: string;
}

interface RubricData {
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
}

export default function RubricEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [rubric, setRubric] = useState<RubricData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/rubrics/${id}`);
        if (!res.ok) {
          setError("Không tìm thấy rubric");
          return;
        }
        const json = (await res.json()) as { data: RubricData };
        setRubric(json.data);
      } catch {
        setError("Đã xảy ra lỗi khi tải rubric");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Đang tải...</p>
      </div>
    );
  }

  if (error || !rubric) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-red-500 text-sm">{error ?? "Không tìm thấy rubric"}</p>
      </div>
    );
  }

  return (
    <>
        {/* Page heading */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Chỉnh sửa rubric</h1>
          <p className="text-sm text-slate-500 mt-1">
            Cập nhật thông tin và các tiêu chí chấm điểm.
          </p>
        </div>

        <RubricForm initialData={rubric} />
    </>
  );
}
