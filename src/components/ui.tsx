"use client";

import { useCallback, useState } from "react";

/**
 * Shared presentational primitives — small, reusable, dark-mode aware.
 */

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50 disabled:cursor-not-allowed select-none";
  const variants = {
    primary:
      "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600",
    secondary:
      "bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-700",
    danger:
      "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900 dark:hover:bg-red-900/40",
    ghost:
      "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
  };
  const sizes = {
    sm: "px-2.5 py-1 text-xs",
    md: "px-3.5 py-1.5 text-sm",
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

export function TextArea({
  mono = false,
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return (
    <textarea
      spellCheck={false}
      className={`w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 ${
        mono ? "font-mono text-[13px] leading-relaxed" : ""
      } ${className}`}
      {...props}
    />
  );
}

export function Input({
  mono = false,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      spellCheck={false}
      className={`w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 ${
        mono ? "font-mono text-[13px]" : ""
      } ${className}`}
      {...props}
    />
  );
}

export function Select({
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 ${className}`}
      {...props}
    />
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
          <div>
            {title && (
              <h2 className="text-sm font-semibold tracking-wide text-zinc-900 dark:text-zinc-100">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ResultBlock({
  title,
  children,
  emptyHint,
}: {
  title: string;
  children?: React.ReactNode;
  emptyHint?: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/60">
      <div className="border-b border-zinc-200 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        {title}
      </div>
      {children ?? (
        <p className="px-3 py-4 text-sm text-zinc-400 dark:text-zinc-500">{emptyHint}</p>
      )}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older browsers / restricted clipboard.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }, [text]);
  return (
    <Button variant="secondary" size="sm" onClick={copy} aria-label={label}>
      {copied ? "✓ Copied" : label}
    </Button>
  );
}

export function Toolbar({
  onClear,
  clearDisabled = false,
  children,
}: {
  onClear?: () => void;
  clearDisabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {onClear && (
        <Button variant="ghost" size="sm" onClick={onClear} disabled={clearDisabled}>
          Clear
        </Button>
      )}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
    >
      {message}
    </div>
  );
}

export function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" | "ok" }) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
    warn: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  };
  return <div className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tones: Record<string, string> = {
    Critical: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    High: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    Medium: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    Low: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    Informational: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${
        tones[severity] ?? tones.Informational
      }`}
    >
      {severity}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tones: Record<string, string> = {
    Investigating: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    Identified: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    Fixed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    Monitoring: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    Closed: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${
        tones[status] ?? tones.Investigating
      }`}
    >
      {status}
    </span>
  );
}

export function DefinitionList({
  items,
}: {
  items: Array<[string, React.ReactNode]>;
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map(([term, value]) => (
        <div key={term} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {term}
          </dt>
          <dd className="mt-0.5 break-words font-mono text-[13px] text-zinc-800 dark:text-zinc-200">
            {value === null || value === undefined || value === "" ? "—" : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}