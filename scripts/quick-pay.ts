const BASE = "http://localhost:3000";
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const csrfJson = await csrfRes.json();
const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [];
const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
const body = new URLSearchParams({ email: "md@phase7.test", password: "TestPass123!", csrfToken: csrfJson.csrfToken, callbackUrl: "/", json: "true" });
const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual" });
const loginCookies = (loginRes as any).headers.getSetCookie?.() || [];
const cookie = loginCookies.map((c: string) => c.split(";")[0]).join("; ");
// Get invoices
const invRes = await fetch(`${BASE}/api/sales/invoices?pageSize=10`, { headers: { Cookie: cookie } });
const invData = await invRes.json();
const issued = invData.items?.find((i: any) => i.status === "issued");
if (issued) {
  console.log("Issued invoice:", issued.id, issued.invoiceNumber, "balance:", issued.balanceDue, "total:", issued.total);
  // Create payment
  const payRes = await fetch(`${BASE}/api/sales/payments`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ customerId: issued.customerId, invoiceId: issued.id, amount: "100.00", paymentMethod: "cash" }) });
  console.log("Payment create:", payRes.status);
  const payData = await payRes.json();
  console.log("Payment:", payData.id, payData.paymentNumber, payData.status);
  // Post payment
  const postRes = await fetch(`${BASE}/api/sales/payments/${payData.id}/post`, { method: "POST", headers: { Cookie: cookie } });
  console.log("Post status:", postRes.status);
  const postData = await postRes.json();
  console.log("Post response status field:", postData.status, "keys:", Object.keys(postData));
} else {
  console.log("No issued invoice found");
}
