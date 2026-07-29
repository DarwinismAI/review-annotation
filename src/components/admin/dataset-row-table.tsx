"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AgreementBadge } from "./agreement-badge";
import { AnnotatorAvatarStack } from "./annotator-avatar-stack";
import { JsonFieldValue } from "./json-field-value";
import { OverlapBadge } from "./overlap-badge";

interface Annotator {
  id: string;
  name: string | null;
  image?: string | null;
}

export interface DatasetRow {
  id: string;
  internalRowId: number;
  listFields: Record<string, unknown>;
  completedCount: number;
  annotatedBy: Annotator[];
  agreement: number | null;
  overlapLabel: string;
  missingCount: number;
}

interface DatasetRowTableProps {
  rows: DatasetRow[];
  listFields: string[];
  selectedRowIds: string[];
  onSelectedRowIdsChange: (ids: string[]) => void;
  onRowOpen?: (row: DatasetRow) => void;
}

export function DatasetRowTable({ rows, listFields, selectedRowIds, onSelectedRowIdsChange, onRowOpen }: DatasetRowTableProps) {
  const tableMinWidth = `${Math.max(960, 360 + listFields.length * 320)}px`;

  function toggle(id: string) {
    onSelectedRowIdsChange(selectedRowIds.includes(id) ? selectedRowIds.filter((item) => item !== id) : [...selectedRowIds, id]);
  }

  function toggleAll() {
    onSelectedRowIdsChange(selectedRowIds.length === rows.length ? [] : rows.map((row) => row.id));
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <Table className="table-auto" style={{ minWidth: tableMinWidth }}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-9">
              <input type="checkbox" checked={rows.length > 0 && selectedRowIds.length === rows.length} onChange={toggleAll} />
            </TableHead>
            <TableHead className="w-16">ID</TableHead>
            {listFields.map((field) => (
              <TableHead key={field} className="min-w-[320px]">
                {field}
              </TableHead>
            ))}
            <TableHead className="w-24">Completed</TableHead>
            <TableHead className="w-28">Annotated by</TableHead>
            <TableHead className="w-28">Agreement</TableHead>
            <TableHead className="w-24">Overlap</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className={onRowOpen ? "cursor-pointer hover:bg-slate-50" : undefined}
              onClick={() => onRowOpen?.(row)}
            >
              <TableCell>
                <input
                  type="checkbox"
                  checked={selectedRowIds.includes(row.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => toggle(row.id)}
                />
              </TableCell>
              <TableCell className="text-slate-600">{row.internalRowId}</TableCell>
              {listFields.map((field) => (
                <TableCell key={field} className="align-top">
                  <JsonFieldValue value={row.listFields[field]} maxLength={220} wrap />
                </TableCell>
              ))}
              <TableCell>{row.completedCount}</TableCell>
              <TableCell>
                <AnnotatorAvatarStack annotators={row.annotatedBy} />
              </TableCell>
              <TableCell>
                <AgreementBadge agreement={row.agreement} />
              </TableCell>
              <TableCell>
                <OverlapBadge overlapLabel={row.overlapLabel} missingCount={row.missingCount} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
