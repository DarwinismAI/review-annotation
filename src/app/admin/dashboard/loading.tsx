export default function AdminDashboardLoading() {
  return (
    <div className="space-y-5" data-testid="dashboard-route-shell">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Tổng quan</h1>
          <p className="text-sm text-slate-500">Theo dõi nhanh dữ liệu, metric và annotator đang hoạt động.</p>
        </div>
        <div className="h-9 w-32 rounded-md bg-slate-100 animate-pulse" />
      </div>

      <div className="space-y-4" data-testid="dashboard-loading-shell">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-md border bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 shrink-0 rounded-md bg-slate-100 animate-pulse" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-24 rounded bg-slate-100 animate-pulse" />
                  <div className="h-7 w-16 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-28 rounded bg-slate-100 animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="grid grid-cols-[minmax(0,2fr)_1fr_80px_80px_80px] gap-3">
                  <div className="h-4 rounded bg-slate-100 animate-pulse" />
                  <div className="h-4 rounded bg-slate-100 animate-pulse" />
                  <div className="h-4 rounded bg-slate-100 animate-pulse" />
                  <div className="h-4 rounded bg-slate-100 animate-pulse" />
                  <div className="h-4 rounded bg-slate-100 animate-pulse" />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
            <div className="h-5 w-20 rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-48 rounded bg-slate-100 animate-pulse" />
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
                <div className="h-4 w-4 shrink-0 rounded bg-slate-100 animate-pulse" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-24 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-44 rounded bg-slate-100 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
