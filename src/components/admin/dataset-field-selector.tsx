"use client";

import { JsonFieldValue } from "./json-field-value";

export interface DatasetField {
  path: string;
  type: string;
  sample: unknown;
}

interface DatasetFieldSelectorProps {
  fields: DatasetField[];
  listFields: string[];
  detailFields: string[];
  onListFieldsChange: (fields: string[]) => void;
  onDetailFieldsChange: (fields: string[]) => void;
}

function toggle(list: string[], field: string) {
  return list.includes(field) ? list.filter((item) => item !== field) : [...list, field];
}

export function DatasetFieldSelector({
  fields,
  listFields,
  detailFields,
  onListFieldsChange,
  onDetailFieldsChange,
}: DatasetFieldSelectorProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <div className="grid grid-cols-[1fr_120px_160px_170px] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
        <div>Field</div>
        <div>Type</div>
        <div>Hiển thị trên list</div>
        <div>Hiển thị trên detail</div>
      </div>
      <div className="max-h-[420px] overflow-auto">
        {fields.map((field) => (
          <div key={field.path} className="grid grid-cols-[1fr_120px_160px_170px] gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0">
            <div className="min-w-0">
              <div className="font-mono text-xs text-slate-800">{field.path}</div>
              <JsonFieldValue value={field.sample} maxLength={80} className="mt-1 text-xs text-slate-500" />
            </div>
            <div className="text-sm text-slate-500">{field.type}</div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={listFields.includes(field.path)}
                onChange={() => onListFieldsChange(toggle(listFields, field.path))}
              />
              List
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={detailFields.includes(field.path)}
                onChange={() => onDetailFieldsChange(toggle(detailFields, field.path))}
              />
              Detail
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
