"use client";

import { useState } from "react";

export default function CopyInviteLink({ inviteId }: { inviteId: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const url = `${window.location.origin}/join?invite=${inviteId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={copy}
      className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand transition hover:bg-brand/20"
    >
      {copied ? "Скопировано ✓" : "Скопировать ссылку"}
    </button>
  );
}
