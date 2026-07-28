"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { OtpInput } from "@/components/otp-input";
import { sendOtp, verifyOtp } from "@/lib/auth-client";

const OTP_TTL_SECONDS = 10 * 60;
const THROTTLE_SECONDS = 60;

function formatMmSs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function SignupOtpPage() {
  return (
    <Suspense fallback={null}>
      <SignupOtpInner />
    </Suspense>
  );
}

function SignupOtpInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [expiresIn, setExpiresIn] = useState(OTP_TTL_SECONDS);
  const [throttleIn, setThrottleIn] = useState(THROTTLE_SECONDS);

  useEffect(() => {
    if (!email) {
      router.replace("/signup");
    }
  }, [email, router]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setExpiresIn((s) => Math.max(0, s - 1));
      setThrottleIn((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  async function verify(token: string) {
    if (!email) return;
    setError("");
    setLoading(true);
    try {
      await verifyOtp({ email, token });
      router.push("/signup/profile");
      // Don't reset loading on success — keep UI in "verifying" state until
      // navigation unmounts the page. Otherwise a tick that hits expiresIn=0
      // mid-await flashes "OTP hết hạn" before redirect lands.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mã không đúng, vui lòng thử lại");
      setOtp("");
      setLoading(false);
    }
  }

  async function resend() {
    if (!email || throttleIn > 0) return;
    setError("");
    setResending(true);
    try {
      await sendOtp({ email, mode: "signup" });
      setExpiresIn(OTP_TTL_SECONDS);
      setThrottleIn(THROTTLE_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gửi lại được mã");
    } finally {
      setResending(false);
    }
  }

  // `loading` guard: while verify is in flight we suppress the expired UI even
  // if the countdown ticks to 0 — server already accepted the token.
  const expired = expiresIn === 0 && !loading;

  return (
    <AuthShell
      brandTagline="Đăng ký chuyên gia"
      brandDescription="Mã 6 chữ số có hiệu lực 10 phút và chỉ dùng được một lần."
      progress={{ active: 1, total: 3 }}
      title="Bước 2 — Mã OTP"
      subtitle={email ? `Mã 6 chữ số đã gửi tới ${email}` : "Đang tải..."}
      footer={{ label: "Sai email?", href: "/signup", cta: "Quay lại" }}
    >
      <div className="space-y-5">
        <OtpInput
          value={otp}
          onChange={setOtp}
          onComplete={verify}
          disabled={loading || expired}
          hasError={Boolean(error)}
        />

        {expired ? (
          <p className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
            Mã đã hết hạn. Hãy bấm &quot;Gửi lại mã&quot;.
          </p>
        ) : (
          <p className="text-xs text-amber-700">
            Mã hết hạn trong{" "}
            <span className="font-mono font-semibold">{formatMmSs(expiresIn)}</span>
          </p>
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          onClick={() => verify(otp)}
          disabled={loading || otp.length !== 6 || expired}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
        >
          {loading ? "Đang xác thực..." : "Xác thực"}
        </button>

        <p className="text-center text-xs text-slate-500">
          Không nhận được mã?{" "}
          {throttleIn > 0 ? (
            <span className="text-slate-400">Gửi lại sau {formatMmSs(throttleIn)}</span>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={resending}
              className="text-blue-600 hover:text-blue-700 font-medium disabled:opacity-60"
            >
              {resending ? "Đang gửi..." : "Gửi lại mã"}
            </button>
          )}
        </p>
      </div>
    </AuthShell>
  );
}
