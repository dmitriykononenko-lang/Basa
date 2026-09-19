import { redirect } from "next/navigation";
import JoinAccept from "@/components/JoinAccept";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  if (!invite) redirect("/dashboard");
  return <JoinAccept inviteId={invite} />;
}
