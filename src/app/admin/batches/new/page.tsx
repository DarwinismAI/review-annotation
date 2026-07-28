import { redirect } from "next/navigation";

export default function LegacyNewBatchRedirectPage() {
  redirect("/admin/datasets/new");
}
