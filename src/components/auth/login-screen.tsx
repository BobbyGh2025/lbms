"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Zap, Loader2, Eye, EyeOff, ShieldCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export function LoginScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // NextAuth redirects to /?error=CredentialsSignin on failure.
  useEffect(() => {
    const err = searchParams.get("error");
    if (err === "CredentialsSignin") {
      setError("Invalid email or password. If you have 5 failed attempts, the account is locked for 15 minutes.");
    } else if (err === "Configuration") {
      setError("Authentication service is misconfigured. Please contact the administrator.");
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (!res || res.error) {
        setError("Invalid email or password. Please try again.");
        return;
      }
      // Refresh to load authenticated shell
      router.refresh();
      router.replace("/");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-teal-50 p-4 dark:from-emerald-950/20 dark:via-background dark:to-teal-950/20">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <Zap className="h-7 w-7" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lightworld Tech</h1>
          <p className="text-sm text-muted-foreground">Business Management System</p>
        </div>
      </div>

      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>
            Enter your credentials to access the management console.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-700 dark:text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@lightworld.tech"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPwd ? "Hide" : "Show"}
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {process.env.NODE_ENV !== "production" && (
        <div className="mt-6 w-full max-w-md rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="mb-1 flex items-center gap-1 font-semibold text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Phase 1 demo credentials
          </p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            <span>
              <span className="font-medium">MD:</span> md@lightworld.tech
            </span>
            <span>
              <span className="font-medium">Admin:</span> admin@lightworld.tech
            </span>
            <span className="sm:col-span-2">
              <span className="font-medium">Passwords:</span> Lightworld@2025 / Admin@2025
            </span>
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} Lightworld Tech · Internal use only · All actions are audited
      </p>
    </div>
  );
}
