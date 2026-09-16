// ============================================================================
// LBMS NextAuth Configuration
// ----------------------------------------------------------------------------
// Credentials provider backed by the Prisma User table + bcrypt password
// hashing. JWT session strategy carries the user's roles + permissions so
// that server-side permission checks do not hit the DB on every request.
// ============================================================================

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { loadUserAuthData, getUserPermissions } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8, // 8 hours
  },
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    callbackUrl: {
      name: `next-auth.callback-url`,
      options: {
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name: `next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: {
    // We render login inline at "/" via the page component. NextAuth still
    // needs a sign-in path; we point it at "/" so redirects stay on the
    // single user-visible route.
    signIn: "/",
    error: "/",
  },
  providers: [
    CredentialsProvider({
      name: "Lightworld Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "you@lightworld.tech" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email.trim().toLowerCase();
        const user = await db.user.findUnique({
          where: { email },
        });

        const ip =
          (req as any)?.headers?.["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
          (req as any)?.headers?.["x-real-ip"]?.toString() ||
          null;
        const ua = (req as any)?.headers?.["user-agent"]?.toString() || null;

        if (!user) {
          await recordAudit({
            action: "login_failed",
            module: "auth",
            description: `Failed login attempt for unknown email: ${email}`,
            ipAddress: ip,
            userAgent: ua,
          });
          return null;
        }

        // Check account status
        if (user.status !== "active") {
          await recordAudit({
            userId: user.id,
            action: "login_failed",
            module: "auth",
            description: `Login blocked — account status: ${user.status}`,
            ipAddress: ip,
            userAgent: ua,
          });
          return null;
        }

        // Check lock
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await recordAudit({
            userId: user.id,
            action: "login_failed",
            module: "auth",
            description: "Login blocked — account temporarily locked",
            ipAddress: ip,
            userAgent: ua,
          });
          return null;
        }

        // Verify password
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) {
          const attempts = user.failedLoginAttempts + 1;
          const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
          await db.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : user.lockedUntil,
            },
          });
          await recordAudit({
            userId: user.id,
            action: "login_failed",
            module: "auth",
            description: shouldLock
              ? `Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts`
              : `Failed login attempt (${attempts}/${MAX_FAILED_ATTEMPTS})`,
            ipAddress: ip,
            userAgent: ua,
          });
          return null;
        }

        // Success — reset counters, update last login
        await db.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
            lastLoginIp: ip,
          },
        });

        const { roles, permissions, isMD } = await loadUserAuthData(user.id);

        await recordAudit({
          userId: user.id,
          action: "login",
          module: "auth",
          description: `User ${user.username} signed in`,
          ipAddress: ip,
          userAgent: ua,
        });

        return {
          id: user.id,
          email: user.email,
          name: user.username,
          username: user.username,
          roles,
          permissions,
          isMD,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.email = user.email;
        token.name = user.name ?? "";
        token.username = (user as any).username;
        token.roles = (user as any).roles;
        token.isMD = (user as any).isMD;
        // NOTE: permissions are NOT stored in the JWT. The MD user has all
        // 150 permissions which makes the JWE ~20KB, exceeding the 4KB cookie
        // limit. NextAuth chunks it into 5 cookies which fails to reassemble
        // (JWEInvalid) under Next.js 16 / Turbopack. Permissions are loaded
        // from a cached DB lookup in the session() callback instead.
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.userId,
        email: token.email,
        name: token.name,
        username: token.username,
        roles: token.roles,
        isMD: token.isMD,
        permissions: token.userId ? await getUserPermissions(token.userId) : [],
      };
      return session;
    },
  },
  events: {
    async signOut(message) {
      // Best-effort logout audit; token may not carry userId in all paths.
      const userId = (message.token as any)?.userId;
      if (userId) {
        await recordAudit({
          userId,
          action: "logout",
          module: "auth",
          description: "User signed out",
        });
      }
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
