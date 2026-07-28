"use client";

import RubricForm from "@/components/rubric-form";

export default function RubricNewPage() {
  return (
    <>
        {/* Page heading */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Tạo metric mới</h1>
          <p className="text-sm text-slate-500 mt-1">
            Mỗi lần tạo một metric, cấu hình thông số chấm và gắn với một lĩnh vực.
          </p>
        </div>

        <RubricForm />
    </>
  );
}
