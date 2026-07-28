import { redirect } from "next/navigation";

export default function LegacyBatchDetailRedirectPage() {
  redirect("/admin/datasets");
}
