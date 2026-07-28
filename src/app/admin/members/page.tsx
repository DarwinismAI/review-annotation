"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS } from "@/lib/labels";
import type { AppRole } from "@/lib/roles";

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: AppRole;
}

function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}

export default function AdminMembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/members")
      .then((res) => {
        if (!res.ok) throw new Error("Không tải được danh sách member");
        return res.json();
      })
      .then((payload) => setMembers(payload.members ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Không tải được danh sách member"))
      .finally(() => setLoading(false));
  }, []);

  async function updateRole(member: Member, role: "admin" | "annotator") {
    setError("");
    setSavingId(member.id);
    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, role }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Không cập nhật được role");
        return;
      }
      setMembers((current) => current.map((item) => (item.id === member.id ? { ...item, role: payload.member.role } : item)));
    } catch {
      setError("Không cập nhật được role");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Phân quyền member</h1>
        <p className="mt-1 text-sm text-slate-500">Chỉ superadmin có quyền đổi member thành admin hoặc annotator.</p>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Role hiện tại</th>
              <th className="px-4 py-3">Đổi role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-500">Đang tải...</td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-500">Chưa có member.</td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{member.name || member.email}</div>
                    <div className="text-xs text-slate-500">{member.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={member.role === "superadmin" ? "default" : "outline"}>{roleLabel(member.role)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {member.role === "superadmin" ? (
                      <span className="text-xs text-slate-500">Không đổi qua màn này</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Select value={member.role} onValueChange={(value) => updateRole(member, value as "admin" | "annotator")}>
                          <SelectTrigger className="w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="annotator">Annotator</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="ghost" disabled size="sm" className={savingId === member.id ? "opacity-100" : "opacity-0"}>
                          Đang lưu
                        </Button>
                      </div>
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
