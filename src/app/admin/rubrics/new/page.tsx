"use client";

import Link from "next/link";
import RubricForm from "@/components/rubric-form";

export default function RubricNewPage() {
  return (
    <>
        {/* Page heading */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Tạo rubric mới</h1>
          <p className="text-sm text-slate-500 mt-1">
            Điền thông tin và thêm các tiêu chí chấm điểm.
          </p>
        </div>

        <RubricForm />
    </>
  );
}
