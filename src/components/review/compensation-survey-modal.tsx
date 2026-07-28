"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { FileText, Clock, AlertCircle, ChevronRight } from "lucide-react";

type Unit = "per_article" | "per_hour";

interface Props {
  open: boolean;
  /** Called after submit succeeds OR user skips. Triggers parent's redirect. */
  onClose: (skipped: boolean) => void;
}

const UNIT_OPTIONS: { value: Unit; label: string; sublabel: string; icon: React.ReactNode }[] = [
  {
    value: "per_article",
    label: "Theo bài",
    sublabel: "Mỗi bài viết hoàn thành",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    value: "per_hour",
    label: "Theo giờ",
    sublabel: "Tính trên mỗi giờ làm việc",
    icon: <Clock className="h-4 w-4" />,
  },
];

export function CompensationSurveyModal({ open, onClose }: Props) {
  const [expectedRate, setExpectedRate] = useState("");
  const [unit, setUnit] = useState<Unit>("per_article");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const trimmed = expectedRate.trim();
    if (!trimmed) {
      setError("Vui lòng nhập mức thù lao mong muốn");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/annotator/compensation-survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRate: trimmed, unit }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(j.error?.message ?? "Gửi khảo sát thất bại");
        setSubmitting(false);
        return;
      }
      onClose(false);
    } catch {
      setError("Đã xảy ra lỗi, vui lòng thử lại");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose(true)}>
      <DialogContent className="sm:max-w-[420px] p-0 overflow-hidden gap-0">

        {/* Header band */}
        <div className="px-6 pt-6 pb-5 border-b border-slate-100">
          {/* Badge */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-medium mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Khảo sát nhanh
          </div>

          <DialogHeader className="space-y-1.5 text-left">
            <DialogTitle className="text-[17px] font-semibold text-slate-900 leading-snug">
              Bạn mong muốn mức thù lao như thế nào?
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500 leading-relaxed">
              Câu trả lời của bạn giúp chúng tôi xây dựng chính sách thù lao phù hợp hơn. Chỉ mất 10 giây.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">

          {/* Rate input */}
          <div className="space-y-2">
            <Label htmlFor="expected-rate" className="text-sm font-medium text-slate-700">
              Mức thù lao mong muốn
            </Label>
            <div className="relative">
              <Input
                id="expected-rate"
                placeholder="VD: 150,000"
                value={expectedRate}
                onChange={(e) => setExpectedRate(e.target.value)}
                disabled={submitting}
                className={cn(
                  "pr-10 h-10 text-sm",
                  error && "border-red-400 focus-visible:ring-red-300"
                )}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400 pointer-events-none select-none">
                đ
              </span>
            </div>
            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>

          {/* Unit selector - card-style */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Đơn vị tính</Label>
            <div className="grid grid-cols-2 gap-2">
              {UNIT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => setUnit(opt.value)}
                  className={cn(
                    "relative flex flex-col items-start gap-1 rounded-lg border px-3.5 py-3 text-left transition-all duration-150 cursor-pointer",
                    unit === opt.value
                      ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                    submitting && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <span className={cn(
                    "transition-colors",
                    unit === opt.value ? "text-blue-600" : "text-slate-400"
                  )}>
                    {opt.icon}
                  </span>
                  <span className={cn(
                    "text-sm font-medium leading-none",
                    unit === opt.value ? "text-blue-700" : "text-slate-700"
                  )}>
                    {opt.label}
                  </span>
                  <span className="text-xs text-slate-400 leading-snug">
                    {opt.sublabel}
                  </span>
                  {unit === opt.value && (
                    <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-blue-500" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/60">
          <button
            type="button"
            onClick={() => onClose(true)}
            disabled={submitting}
            className="text-sm text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50 cursor-pointer"
          >
            Bỏ qua
          </button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="gap-1.5 h-9 px-5 text-sm"
          >
            {submitting ? (
              <>
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Đang gửi…
              </>
            ) : (
              <>
                Gửi khảo sát
                <ChevronRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
