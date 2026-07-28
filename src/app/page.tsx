import { redirect } from "next/navigation";

export default function HomePage() {
  // Local dev → straight to admin dashboard
  if (process.env.LOCAL_DB_PATH) {
    redirect("/admin/dashboard");
  }
  redirect("/login");
}
