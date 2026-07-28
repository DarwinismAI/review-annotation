"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface Annotator {
  id: string;
  name: string | null;
  image?: string | null;
}

interface AnnotatorAvatarStackProps {
  annotators: Annotator[];
  maxVisible?: number;
}

function initials(name: string | null) {
  return (name ?? "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AnnotatorAvatarStack({ annotators, maxVisible = 3 }: AnnotatorAvatarStackProps) {
  const visible = annotators.slice(0, maxVisible);
  const extra = annotators.length - visible.length;

  return (
    <div className="flex items-center -space-x-2">
      {visible.map((annotator) => (
        <Avatar key={annotator.id} className="h-7 w-7 border border-white">
          <AvatarImage src={annotator.image ?? undefined} />
          <AvatarFallback className="text-[10px]">{initials(annotator.name)}</AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && (
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white bg-slate-100 text-[10px] font-medium text-slate-600">
          +{extra}
        </div>
      )}
    </div>
  );
}
