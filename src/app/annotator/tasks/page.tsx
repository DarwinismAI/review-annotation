"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useJsonResource } from "@/hooks/use-json-resource";

interface AnnotatorTaskGroup {
  id: string;
  assignmentRunId: string;
  datasetId: string;
  datasetName: string;
  assignedAt: string;
  metricLabels: string[];
  totalCount: number;
  submittedCount: number;
  remainingCount: number;
  skippedCount: number;
  status: string;
}

interface TasksPayload {
  taskGroups?: AnnotatorTaskGroup[];
}

const EMPTY_TASKS: TasksPayload = { taskGroups: [] };

export default function AnnotatorTasksPage() {
  const { data, error, loading } = useJsonResource<TasksPayload>("/api/annotator/task-groups", EMPTY_TASKS);
  const taskGroups = data.taskGroups ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Task được giao</h1>
        <p className="text-sm text-slate-500">Đang hiển thị {taskGroups.length} nhóm task.</p>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dataset</TableHead>
              <TableHead>Assigned</TableHead>
              <TableHead>Metrics</TableHead>
              <TableHead>Remaining</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Skipped</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell><div className="h-4 w-48 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-32 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-44 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-16 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-16 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-16 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-5 w-20 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="ml-auto h-8 w-14 rounded bg-slate-100" /></TableCell>
                </TableRow>
              ))}
            {!loading && taskGroups.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-slate-500">
                  Chưa có task được giao.
                </TableCell>
              </TableRow>
            )}
            {taskGroups.map((group) => (
              <TableRow key={group.id}>
                <TableCell className="font-medium text-slate-900">{group.datasetName}</TableCell>
                <TableCell>{new Date(group.assignedAt).toLocaleDateString("vi-VN")}</TableCell>
                <TableCell>{group.metricLabels.join(", ") || group.assignmentRunId}</TableCell>
                <TableCell>{group.remainingCount} / {group.totalCount}</TableCell>
                <TableCell>{group.submittedCount}</TableCell>
                <TableCell>{group.skippedCount}</TableCell>
                <TableCell>
                  <Badge variant={group.status === "completed" ? "success" : "secondary"}>{group.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/annotator/tasks/${group.id}`}>Mở</Link>
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
