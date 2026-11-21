"use client";

import clsx from "clsx";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";

type ButtonVariant = "primary" | "secondary" | "accent" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        {
          primary: "bg-brand-700 text-white hover:bg-brand-800",
          secondary: "border border-line bg-white text-ink hover:bg-brand-50",
          accent: "bg-accent-500 text-ink hover:bg-accent-600",
          ghost: "text-brand-700 hover:bg-brand-50",
          danger: "bg-danger text-white hover:opacity-90",
        }[variant],
        className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("rounded-2xl bg-white p-4 shadow-sm", className)}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function Label({ htmlFor, label, hint }: { htmlFor: string; label: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-2 text-xs text-muted">
      <span>{label}</span>
      {hint && <span className="text-[11px]">{hint}</span>}
    </label>
  );
}

const fieldClass =
  "min-h-11 w-full rounded-xl border border-line bg-white px-3 text-[15px] text-ink outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-100 disabled:bg-canvas disabled:text-muted";

export function Input({
  label,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <Label htmlFor={id} label={label} hint={hint} />
      <input id={id} {...props} className={fieldClass} />
    </div>
  );
}

export function Textarea({
  label,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const id = useId();
  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <Label htmlFor={id} label={label} />
      <textarea id={id} {...props} className={clsx(fieldClass, "min-h-24 py-2")} />
    </div>
  );
}

export function Select({
  label,
  hint,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <Label htmlFor={id} label={label} hint={hint} />
      <select id={id} {...props} className={fieldClass}>
        {children}
      </select>
    </div>
  );
}

type Tone = "ok" | "warn" | "danger" | "info" | "neutral";
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        {
          ok: "bg-ok-bg text-ok",
          warn: "bg-warn-bg text-warn",
          danger: "bg-danger-bg text-danger",
          info: "bg-info-bg text-info",
          neutral: "bg-canvas text-muted",
        }[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Notice({ tone = "danger", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={clsx("rounded-xl px-3 py-2 text-sm", {
        ok: "bg-ok-bg text-ok",
        warn: "bg-warn-bg text-warn",
        danger: "bg-danger-bg text-danger",
        info: "bg-info-bg text-info",
        neutral: "bg-canvas text-muted",
      }[tone])}
    >
      {children}
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}
