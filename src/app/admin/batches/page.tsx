import { redirect } from "next/navigation";

export default function LegacyBatchesRedirectPage() {
  redirect("/admin/datasets");
}
