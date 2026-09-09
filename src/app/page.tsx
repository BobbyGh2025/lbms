import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { LoginScreen } from "@/components/auth/login-screen";
import { AppShell } from "@/components/layout/app-shell";
import { ViewRouter } from "@/components/views/view-router";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return (
      <Suspense fallback={null}>
        <LoginScreen />
      </Suspense>
    );
  }

  return (
    <AppShell>
      <ViewRouter />
    </AppShell>
  );
}
