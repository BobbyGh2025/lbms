const BASE = "http://localhost:3000";
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const csrfJson = await csrfRes.json();
const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [];
const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
const body = new URLSearchParams({ email: "md@phase7.test", password: "TestPass123!", csrfToken: csrfJson.csrfToken, callbackUrl: "/", json: "true" });
const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual" });
const loginCookies = (loginRes as any).headers.getSetCookie?.() || [];
const cookie = loginCookies.map((c: string) => c.split(";")[0]).join("; ");

// Check variance endpoint
const budgetsRes = await fetch(`${BASE}/api/budgets?status=approved`, { headers: { Cookie: cookie } });
const budgets = await budgetsRes.json();
const approved = budgets.items?.find((b: any) => b.status === "approved");
if (approved) {
  const varRes = await fetch(`${BASE}/api/budgets/${approved.id}/variance`, { headers: { Cookie: cookie } });
  const varData = await varRes.json();
  console.log("Variance status:", varRes.status);
  console.log("Variance keys:", Object.keys(varData));
  console.log("budget:", JSON.stringify(varData.budget)?.slice(0, 200));
  console.log("actuals:", JSON.stringify(varData.actuals)?.slice(0, 200));
  console.log("lines:", Array.isArray(varData.lines) ? `array(${varData.lines.length})` : typeof varData.lines);
}

// Check cash forecast
const cfRes = await fetch(`${BASE}/api/budgets/cash-forecast`, { headers: { Cookie: cookie } });
const cfData = await cfRes.json();
console.log("\nCash Forecast status:", cfRes.status);
console.log("Cash Forecast keys:", Object.keys(cfData));
console.log("openingCash:", cfData.openingCash);
console.log("expectedCollections:", cfData.expectedCollections);
console.log("expectedPayments:", cfData.expectedPayments);
console.log("plannedExpenses:", cfData.plannedExpenses);
console.log("projectedClosingCash:", cfData.projectedClosingCash);

// Check forecast
const fcRes = await fetch(`${BASE}/api/budgets/forecast`, { headers: { Cookie: cookie } });
const fcData = await fcRes.json();
console.log("\nForecast status:", fcRes.status);
console.log("Forecast keys:", Object.keys(fcData));
