import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardDataRegion } from "./dashboard-data-region";

export default function AdminDashboardPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Tổng quan</h1>
          <p className="text-sm text-slate-500">Theo dõi nhanh dữ liệu, metric và annotator đang hoạt động.</p>
        </div>
        <Button asChild>
          <Link href="/admin/datasets/new">
            <Plus className="h-4 w-4" />
            Tạo dataset
          </Link>
        </Button>
      </div>

      <DashboardDataRegion />
    </div>
  );
}
