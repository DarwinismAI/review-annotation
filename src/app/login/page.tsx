"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { sendOtp } from "@/lib/auth-client";

const ADMIN_EMAIL = "admin@expert-review.local";

export default function LoginEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
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
    const trimmed = email.trim();
    setLoading(true);
    try {
      // Admin shortcut: hardcoded OTP, no email actually sent — go straight to the code step.
      if (trimmed.toLowerCase() !== ADMIN_EMAIL) {
        await sendOtp({ email: trimmed, mode: "login" });
      }
      router.push(`/login/otp?email=${encodeURIComponent(trimmed)}`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      // Supabase trả về "Signups not allowed for otp" khi email chưa đăng ký ở mode login (shouldCreateUser=false).
      if (/signups? not allowed/i.test(raw)) {
        setError("Tài khoản này chưa tồn tại, bạn đã đăng ký tài khoản chưa?");
      } else {
        setError(raw || "Không gửi được mã, vui lòng thử lại");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      brandTagline="Đăng nhập an toàn"
      brandDescription="Mỗi lần đăng nhập, hệ thống gửi một mã 6 chữ số tới email của bạn. Không cần nhớ mật khẩu — không lưu mật khẩu."
      progress={{ active: 0, total: 2 }}
      title="Đăng nhập"
      subtitle="Nhập email để nhận mã OTP đăng nhập."
      footer={{
        label: "Chưa có tài khoản?",
        href: "/signup",
        cta: "Đăng ký chuyên gia",
      }}
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

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
        >
          {loading ? "Đang gửi mã..." : "Gửi mã OTP"}
        </button>
      </form>
    </AuthShell>
  );
}
