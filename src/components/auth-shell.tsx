"use client";

import { ReactNode } from "react";
import Link from "next/link";

/**
 * Two-panel auth chrome shared by auth screens.
 * Left panel = navy brand block; right panel = the form supplied via children.
 *
 * `progress` renders the wizard dots — pass `null` for single-step screens (login B1).
 */
export interface AuthShellProps {
  /** Left-panel headline, e.g. "Đăng nhập nội bộ". */
  brandTagline: string;
  /** Left-panel description below the tagline. */
  brandDescription: string;
  /** 0-based active dot index, total dots, or null to hide the wizard nav. */
  progress: { active: number; total: number } | null;
  /** Form title, e.g. "Đăng nhập". */
  title: string;
  /** Subtitle below the form title. */
  subtitle: string;
  /** Optional footer link below the form. */
  footer?: { label: string; href: string; cta: string };
  children: ReactNode;
}

export function AuthShell({
  brandTagline,
  brandDescription,
  progress,
  title,
  subtitle,
  footer,
  children,
}: AuthShellProps) {
  return (
    <div className="min-h-screen flex">
      {/* Left brand panel */}
      <aside
        className="hidden md:flex flex-col justify-between bg-gradient-to-br from-blue-700 to-blue-900 px-10 py-12"
        style={{ width: "38%" }}
      >
        <div>
          <div className="flex items-center gap-3 mb-10">
            <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div>
              <p className="text-xl font-bold text-white leading-tight">Expert Review</p>
              <p className="text-sm text-blue-400 font-medium">{brandTagline}</p>
            </div>
          </div>

          <p className="text-blue-100 text-sm leading-relaxed">{brandDescription}</p>
        </div>

        <p className="text-blue-300 text-xs">
          Nền tảng review AI &middot; Tài khoản nội bộ.
        </p>
      </aside>

      {/* Right form panel */}
      <main className="flex-1 flex items-center justify-center bg-white px-8 py-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8 md:hidden">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <span className="font-bold text-slate-900">Expert Review</span>
          </div>

          {progress ? (
            <nav
              aria-label="Tiến độ đăng ký"
              className="flex items-center gap-2 mb-6"
            >
              {Array.from({ length: progress.total }, (_, i) => (
                <span
                  key={i}
                  aria-current={i === progress.active ? "step" : undefined}
                  className={
                    "h-2 rounded-full transition-all " +
                    (i === progress.active
                      ? "w-6 bg-blue-600"
                      : i < progress.active
                      ? "w-2 bg-blue-300"
                      : "w-2 bg-slate-200")
                  }
                />
              ))}
            </nav>
          ) : null}

          <h2 className="text-2xl font-bold text-slate-900 mb-1.5">{title}</h2>
          <p className="text-slate-500 text-sm mb-8">{subtitle}</p>

          {children}

          {footer ? (
            <p className="text-center text-sm text-slate-500 mt-8">
              {footer.label}{" "}
              <Link
                href={footer.href}
                className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                {footer.cta}
              </Link>
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
