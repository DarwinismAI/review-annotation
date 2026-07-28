import { AppShell } from "@/components/app-shell";

export default async function ExpertLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell variant="expert">{children}</AppShell>;
}
