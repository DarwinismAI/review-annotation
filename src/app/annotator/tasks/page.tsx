"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { JsonFieldValue } from "@/components/admin/json-field-value";
import { useJsonResource } from "@/hooks/use-json-resource";

interface AnnotatorTask {
  id: string;
  datasetName: string;
  internalRowId: number;
  status: string;
  assignedAt: string;
  listFields: Record<string, unknown>;
  metricLabels: string[];
}

interface TasksPayload {
  tasks?: AnnotatorTask[];
  total?: number;
}

const EMPTY_TASKS: TasksPayload = { tasks: [], total: 0 };

export default function AnnotatorTasksPage() {
  const { data, error, loading } = useJsonResource<TasksPayload>("/api/annotator/tasks", EMPTY_TASKS);
  const tasks = data.tasks ?? [];
  const total = data.total ?? tasks.length;

  const listFields = Array.from(new Set(tasks.flatMap((task) => Object.keys(task.listFields))));
  const visibleListFields = loading ? ["Dữ liệu"] : listFields;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Task của tôi</h1>
        <p className="text-sm text-slate-500">Đang hiển thị {tasks.length} / {total} task mới nhất.</p>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dataset</TableHead>
              <TableHead>ID</TableHead>
              {visibleListFields.map((field) => (
                <TableHead key={field}>{field}</TableHead>
              ))}
              <TableHead>Metrics</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell><div className="h-4 w-48 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-12 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-40 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-5 w-24 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-5 w-20 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="ml-auto h-8 w-14 rounded bg-slate-100" /></TableCell>
                </TableRow>
              ))}
            {!loading && tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleListFields.length + 5} className="text-slate-500">
                  Chưa có task.
                </TableCell>
              </TableRow>
            )}
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="font-medium text-slate-900">{task.datasetName}</TableCell>
                <TableCell>{task.internalRowId}</TableCell>
                {listFields.map((field) => (
                  <TableCell key={field}>
                    <JsonFieldValue value={task.listFields[field]} />
                  </TableCell>
                ))}
                <TableCell>{task.metricLabels.join(", ")}</TableCell>
                <TableCell>
                  <Badge variant={task.status === "completed" ? "success" : "secondary"}>{task.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/annotator/tasks/${task.id}`}>Mở</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
