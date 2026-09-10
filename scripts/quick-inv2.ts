const BASE = "http://localhost:3000";
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const csrfJson = await csrfRes.json();
const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [];
const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
const body = new URLSearchParams({ email: "md@phase7.test", password: "TestPass123!", csrfToken: csrfJson.csrfToken, callbackUrl: "/", json: "true" });
const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual" });
const loginCookies = (loginRes as any).headers.getSetCookie?.() || [];
const cookie = loginCookies.map((c: string) => c.split(";")[0]).join("; ");
// Get customers first
const custRes = await fetch(`${BASE}/api/customers?pageSize=1`, { headers: { Cookie: cookie } });
const custData = await custRes.json();
const custId = custData.items?.[0]?.id;
console.log("Customer ID:", custId);
// Create invoice
const invRes = await fetch(`${BASE}/api/sales/invoices`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ customerId: custId, dueDate: new Date(Date.now() + 86400000).toISOString() }) });
console.log("Invoice create status:", invRes.status);
const inv = await invRes.json();
console.log("Invoice:", inv.id, inv.invoiceNumber, inv.status);
// Add item
const itemRes = await fetch(`${BASE}/api/sales/invoices/${inv.id}/items`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ description: "Test", quantity: "10", unitPrice: "500.00", discount: "0", taxRate: "15" }) });
console.log("Item add status:", itemRes.status);
const getRes = await fetch(`${BASE}/api/sales/invoices/${inv.id}`, { headers: { Cookie: cookie } });
const invData = await getRes.json();
console.log("subtotal:", JSON.stringify(invData.subtotal));
console.log("tax:", JSON.stringify(invData.tax));
console.log("total:", JSON.stringify(invData.total));
console.log("balanceDue:", JSON.stringify(invData.balanceDue));
