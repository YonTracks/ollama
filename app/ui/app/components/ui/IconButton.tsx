"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  variant?: "ghost" | "solid" | "danger";
}

export function IconButton({
  label,
  children,
  className,
  variant = "ghost",
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 flex-none items-center justify-center rounded-md border text-sm transition",
        "focus:focus-ring disabled:opacity-45",
        variant === "ghost" &&
          "border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
        variant === "solid" &&
          "border-accent/50 bg-accent text-accent-foreground hover:bg-accent/90",
        variant === "danger" &&
          "border-danger/40 bg-danger/10 text-danger hover:bg-danger/15",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
