const BASE = "http://localhost:3000";
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const csrfJson = await csrfRes.json();
console.log("CSRF status:", csrfRes.status, "token:", csrfJson.csrfToken?.slice(0, 20));
const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [];
console.log("CSRF cookies:", csrfCookies.length);
const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
console.log("CSRF cookie str:", csrfCookieStr.slice(0, 50));

const body = new URLSearchParams({ email: "md@phase7.test", password: "TestPass123!", csrfToken: csrfJson.csrfToken, callbackUrl: "/", json: "true" });
const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual",
});
console.log("Login status:", loginRes.status);
const loginCookies = (loginRes as any).headers.getSetCookie?.() || [];
console.log("Login cookies:", loginCookies.length);
const allCookies = loginCookies.map((c: string) => c.split(";")[0]).join("; ");
console.log("Has session-token:", allCookies.includes("session-token"));
