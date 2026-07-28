"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getSessionUser, signInWithPassword } from "@/lib/auth-client";

export default function LoginEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function isValidEmail(e: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!isValidEmail(email)) {
      setError("Email không hợp lệ");
      return;
    }
    if (!password) {
      setError("Vui lòng nhập mật khẩu");
      return;
    }
    const trimmed = email.trim();
    setLoading(true);
    try {
      await signInWithPassword({ email: trimmed, password });
      const user = await getSessionUser();
      router.push(user?.role === "admin" || user?.role === "superadmin" ? "/admin" : "/expert");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Email hoặc mật khẩu không đúng");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      brandTagline="Đăng nhập nội bộ"
      brandDescription="Tài khoản được tạo sẵn bởi admin. Sử dụng email công việc và mật khẩu đã được cấp."
      progress={null}
      title="Đăng nhập"
      subtitle="Nhập email và mật khẩu để vào hệ thống."
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="ban@congty.vn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg placeholder-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 outline-none transition"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
            Mật khẩu
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Nhập mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg placeholder-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 outline-none transition"
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
        >
          {loading ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </AuthShell>
  );
}
