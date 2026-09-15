const BASE = "http://localhost:3000";
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const csrfJson = await csrfRes.json();
const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [];
const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
const body = new URLSearchParams({ email: "md@phase7.test", password: "TestPass123!", csrfToken: csrfJson.csrfToken, callbackUrl: "/", json: "true" });
const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual" });
const loginCookies = (loginRes as any).headers.getSetCookie?.() || [];
const cookie = loginCookies.map((c: string) => c.split(";")[0]).join("; ");
// Create budget
const createRes = await fetch(`${BASE}/api/budgets`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Debug lifecycle", fiscalYear: 2026, startDate: "2026-01-01", endDate: "2026-12-31" }) });
const createData = await createRes.json();
console.log("Create:", createRes.status, createData.id, createData.budgetNumber);
// Add line
const lineRes = await fetch(`${BASE}/api/budgets/${createData.id}/lines`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ ledgerAccountCode: "EXP-RENT", month: 1, amount: "1000.00" }) });
console.log("Add line:", lineRes.status);
// Submit
const submitRes = await fetch(`${BASE}/api/budgets/${createData.id}/submit`, { method: "POST", headers: { Cookie: cookie } });
console.log("Submit:", submitRes.status);
const submitData = await submitRes.json();
console.log("Submit response:", JSON.stringify(submitData).slice(0, 200));
