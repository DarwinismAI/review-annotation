"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { JsonFieldValue } from "@/components/admin/json-field-value";

interface AnnotatorTask {
  id: string;
  datasetName: string;
  internalRowId: number;
  status: string;
  assignedAt: string;
  listFields: Record<string, unknown>;
  metricLabels: string[];
}

export default function ExpertTasksPage() {
  const [tasks, setTasks] = useState<AnnotatorTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/annotator/tasks")
      .then((response) => response.json())
      .then((payload) => setTasks(payload.tasks ?? []))
      .finally(() => setLoading(false));
  }, []);

  const listFields = Array.from(new Set(tasks.flatMap((task) => Object.keys(task.listFields))));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Task của tôi</h1>
        <p className="text-sm text-slate-500">Các dòng dataset được giao để chấm metric.</p>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dataset</TableHead>
              <TableHead>ID</TableHead>
              {listFields.map((field) => (
                <TableHead key={field}>{field}</TableHead>
              ))}
              <TableHead>Metrics</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={listFields.length + 5} className="text-slate-500">
                  Đang tải...
                </TableCell>
              </TableRow>
            )}
            {!loading && tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={listFields.length + 5} className="text-slate-500">
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
