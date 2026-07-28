import { redirect } from "next/navigation";

export default function LegacyAnnotatorDashboardRedirectPage() {
  redirect("/annotator/tasks");
}
