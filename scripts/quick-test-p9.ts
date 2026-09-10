const BASE = "http://localhost:3000";
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const csrfJson = await csrfRes.json();
const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [];
const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
const body = new URLSearchParams({ email: "md@phase7.test", password: "TestPass123!", csrfToken: csrfJson.csrfToken, callbackUrl: "/", json: "true" });
const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual",
});
const loginCookies = (loginRes as any).headers.getSetCookie?.() || [];
const cookie = loginCookies.map((c: string) => c.split(";")[0]).join("; ");
console.log("Cookie has session:", cookie.includes("session-token"));
// Test the executive endpoint
const res = await fetch(`${BASE}/api/reports/management/executive?preset=year`, { headers: { Cookie: cookie } });
console.log("Executive status:", res.status);
const data = await res.json();
console.log("Revenue:", data?.financial?.totalRevenue);
