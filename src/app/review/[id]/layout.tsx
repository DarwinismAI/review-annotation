/**
 * Review screen layout — deliberately NO AppShell.
 * The split-panel annotation UI needs full viewport for maximum
 * reading space. The page renders its own top bar with back-link,
 * progress indicator, time tracking, and save button.
 */
export default function ReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
