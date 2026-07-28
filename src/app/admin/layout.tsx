import { AppShell } from "@/components/app-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell variant="admin">{children}</AppShell>;
}
