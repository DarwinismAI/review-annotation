import { redirect } from "next/navigation";

export default function HomePage() {
  // Local dev starts at the primary admin workspace.
  if (process.env.LOCAL_DB_PATH) {
    redirect("/admin/datasets");
  }
  redirect("/login");
}
