"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";

export default function SignupEmailPage() {
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
    if (password.length < 8) {
      setError("Mật khẩu phải có ít nhất 8 ký tự");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/signup/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(json.error?.message ?? "Không đăng ký được, vui lòng thử lại");
        return;
      }
      router.push("/signup/profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đăng ký được, vui lòng thử lại");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      brandTagline="Đăng ký chuyên gia"
      brandDescription="Tạo tài khoản chuyên gia review trong 2 bước. Không cần đợi OTP — đặt mật khẩu rồi hoàn tất hồ sơ."
      progress={{ active: 0, total: 2 }}
      title="Bước 1 — Đặt mật khẩu"
      subtitle="Nhập email công việc và đặt mật khẩu để vào ngay bước hồ sơ."
      footer={{ label: "Đã có tài khoản?", href: "/login", cta: "Đăng nhập" }}
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
            autoComplete="new-password"
            placeholder="Ít nhất 8 ký tự"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg placeholder-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 outline-none transition"
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
        >
          {loading ? "Đang tạo tài khoản..." : "Tiếp tục"}
        </button>
      </form>
    </AuthShell>
  );
}
