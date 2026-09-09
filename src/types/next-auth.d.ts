// ============================================================================
// NextAuth Type Augmentation
// Adds role/permission data to the JWT token and session object.
// ============================================================================

import NextAuth, { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      username: string;
      roles: string[];
      permissions: string[];
      isMD: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    email: string;
    username: string;
    roles: string[];
    permissions: string[];
    isMD: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    email: string;
    name: string;
    username: string;
    roles: string[];
    permissions: string[];
    isMD: boolean;
  }
}
