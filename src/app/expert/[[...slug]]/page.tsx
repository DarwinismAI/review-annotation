import { redirect } from "next/navigation";

export default async function LegacyExpertRedirect({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  redirect(`/annotator${slug.length ? `/${slug.join("/")}` : ""}`);
}
