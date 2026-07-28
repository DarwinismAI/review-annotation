import { AppShell } from "@/components/app-shell";

export default async function AnnotatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell variant="annotator">{children}</AppShell>;
}
