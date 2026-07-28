import { redirect } from "next/navigation";

export default function LegacyAdminDashboardRedirectPage() {
  redirect("/admin/datasets");
}
