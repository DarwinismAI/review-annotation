"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Lightweight toggle switch — no @radix-ui/react-switch dependency. */
interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, onCheckedChange, onChange, ...props }, ref) => {
    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      onChange?.(e);
      onCheckedChange?.(e.target.checked);
    }

    return (
      <label className={cn("relative inline-flex h-5 w-9 cursor-pointer items-center", className)}>
        <input
          ref={ref}
          type="checkbox"
          className="sr-only peer"
          onChange={handleChange}
          {...props}
        />
        <span className="h-5 w-9 rounded-full bg-slate-200 transition-colors peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-600 peer-focus-visible:ring-offset-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-50" />
        <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </label>
    );
  }
);
Switch.displayName = "Switch";

export { Switch };
