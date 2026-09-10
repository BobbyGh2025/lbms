const BASE = "http://localhost:3000";
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const csrfJson = await csrfRes.json();
const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [];
const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
const body = new URLSearchParams({ email: "md@phase7.test", password: "TestPass123!", csrfToken: csrfJson.csrfToken, callbackUrl: "/", json: "true" });
const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual" });
const loginCookies = (loginRes as any).headers.getSetCookie?.() || [];
const cookie = loginCookies.map((c: string) => c.split(";")[0]).join("; ");
// Get quotes list
const qRes = await fetch(`${BASE}/api/sales/quotes?pageSize=10`, { headers: { Cookie: cookie } });
const qData = await qRes.json();
console.log("Quotes:", qData.items?.map((q: any) => ({ num: q.quoteNumber, status: q.status, id: q.id })));
// Find an accepted quote
const accepted = qData.items?.find((q: any) => q.status === "accepted");
if (accepted) {
  console.log("Accepted quote:", accepted.id, accepted.quoteNumber);
  // Add item
  const itemRes = await fetch(`${BASE}/api/sales/quotes/${accepted.id}/items`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ description: "Test item", quantity: "1", unitPrice: "100.00", discount: "0", taxRate: "0" }) });
  console.log("Add item status:", itemRes.status);
  // Convert
  const convRes = await fetch(`${BASE}/api/sales/quotes/${accepted.id}/convert`, { method: "POST", headers: { Cookie: cookie } });
  console.log("Convert status:", convRes.status);
  const convData = await convRes.json();
  console.log("Convert response:", JSON.stringify(convData).slice(0, 200));
} else {
  console.log("No accepted quote found");
}
