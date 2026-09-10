const BASE = "http://localhost:3000";
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const csrfToken = (await csrfRes.json()).csrfToken;
const csrfCookie = (csrfRes.headers.get("set-cookie") || "").split(";")[0];
console.log("CSRF token:", csrfToken?.slice(0, 20) + "...");
console.log("CSRF cookie:", csrfCookie);

const body = new URLSearchParams({ email: "md@phase7.test", password: "TestPass123!", csrfToken, callbackUrl: "/", json: "true" });
const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookie },
  body,
  redirect: "manual",
});
console.log("Login status:", loginRes.status);
console.log("Login set-cookie:", (loginRes.headers.get("set-cookie") || "").slice(0, 200));
const text = await loginRes.text();
console.log("Login body:", text.slice(0, 300));
