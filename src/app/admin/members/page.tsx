"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJsonResource } from "@/hooks/use-json-resource";
import { ROLE_LABELS, labelForDomain } from "@/lib/labels";
import type { AppRole } from "@/lib/roles";

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: AppRole;
  annotatorProfileId: string | null;
  annotatorDomain: string | null;
  annotatorStatus: string | null;
}

interface MembersPayload {
  canManageRoles?: boolean;
  members?: Member[];
}

const EMPTY_MEMBERS: MembersPayload = { canManageRoles: false, members: [] };

const STATUS_LABELS: Record<string, string> = {
  active: "Đang hoạt động",
  inactive: "Tạm dừng",
  pending: "Chờ kích hoạt",
};

function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}

function statusLabel(status: string | null): string {
  return status ? STATUS_LABELS[status] ?? status : "-";
}

export default function AdminMembersPage() {
  const { data, error: loadError, loading, setData } = useJsonResource<MembersPayload>("/api/admin/members", EMPTY_MEMBERS);
  const members = data.members ?? [];
  const canManageRoles = Boolean(data.canManageRoles);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState("");
  const error = mutationError || loadError || "";

  async function updateRole(member: Member, role: "admin" | "annotator") {
    setMutationError("");
    setSavingId(member.id);
    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, role }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMutationError(payload.error ?? "Không cập nhật được role");
        return;
      }
      setData((current) => ({
        ...current,
        members: (current.members ?? []).map((item) => (item.id === member.id ? { ...item, role: payload.member.role } : item)),
      }));
    } catch {
      setMutationError("Không cập nhật được role");
    } finally {
      setSavingId(null);
    }
  }

  async function updateAnnotatorStatus(member: Member, status: "active" | "inactive") {
    if (!member.annotatorProfileId) return;
    setMutationError("");
    setSavingId(member.id);
    try {
      const res = await fetch(`/api/annotators/${member.annotatorProfileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMutationError(payload.error?.message ?? "Không cập nhật được trạng thái annotator");
        return;
      }
      setData((current) => ({
        ...current,
        members: (current.members ?? []).map((item) =>
          item.id === member.id
            ? {
                ...item,
                annotatorStatus: payload.data?.status ?? status,
                annotatorDomain: payload.data?.domain ?? item.annotatorDomain,
              }
            : item,
        ),
      }));
    } catch {
      setMutationError("Không cập nhật được trạng thái annotator");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Thành viên</h1>
        <p className="mt-1 text-sm text-slate-500">Quản lý role, trạng thái annotator và domain trong một màn.</p>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Thành viên</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Annotator</th>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={index}>
                  <td className="px-4 py-4"><div className="h-4 w-48 rounded bg-slate-100" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-24 rounded bg-slate-100" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-28 rounded bg-slate-100" /></td>
                  <td className="px-4 py-4"><div className="h-4 w-32 rounded bg-slate-100" /></td>
                  <td className="px-4 py-4"><div className="h-8 w-36 rounded bg-slate-100" /></td>
                </tr>
              ))
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">Chưa có thành viên.</td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{member.name || member.email}</div>
                    <div className="text-xs text-slate-500">{member.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {member.role === "superadmin" || !canManageRoles ? (
                      <Badge variant={member.role === "superadmin" ? "default" : "outline"}>{roleLabel(member.role)}</Badge>
                    ) : (
                      <Select value={member.role} onValueChange={(value) => updateRole(member, value as "admin" | "annotator")}>
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="annotator">{roleLabel("annotator")}</SelectItem>
                          <SelectItem value="admin">{roleLabel("admin")}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={member.annotatorStatus === "active" ? "success" : "outline"}>{statusLabel(member.annotatorStatus)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {member.annotatorDomain ? labelForDomain(member.annotatorDomain) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {member.annotatorProfileId && member.annotatorStatus !== "active" ? (
                      <Button type="button" variant="outline" size="sm" disabled={savingId === member.id} onClick={() => updateAnnotatorStatus(member, "active")}>
                        Kích hoạt
                      </Button>
                    ) : member.annotatorProfileId ? (
                      <Button type="button" variant="outline" size="sm" disabled={savingId === member.id} onClick={() => updateAnnotatorStatus(member, "inactive")}>
                        Tạm dừng
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">Không phải annotator</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
