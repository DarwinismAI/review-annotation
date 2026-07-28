import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui standard cn() helper */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
