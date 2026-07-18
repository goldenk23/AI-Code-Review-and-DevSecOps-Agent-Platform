import type { ButtonHTMLAttributes, ReactNode } from "react";

// Two button variants, both used across the dashboard:
//   - "primary": indigo bg, dark text -> the main call-to-action ("Sign in", "Post comment").
//   - "ghost":   border-only, dim text -> secondary ("Trigger Analysis" placeholders, etc).
// Disabled state mutes the button and removes pointer interactions.
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
  children: ReactNode;
};

export function Button({ variant = "ghost", className = "", children, disabled, ...rest }: Props) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded font-subheading text-subheading px-4 py-2 transition-all duration-200 focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none";
  const variants = {
    primary: "bg-primary text-on-primary hover:brightness-110",
    ghost: "bg-surface-container-low border border-border-dark text-text-primary hover:bg-surface-container-highest",
  };
  const disabledCls = disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : "";
  return (
    <button className={`${base} ${variants[variant]} ${disabledCls} ${className}`} disabled={disabled} {...rest}>
      {children}
    </button>
  );
}