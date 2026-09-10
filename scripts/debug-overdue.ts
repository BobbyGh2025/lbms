const BASE = "http://localhost:3000";
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const csrfJson = await csrfRes.json();
const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [];
const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
const body = new URLSearchParams({ email: "md@phase7.test", password: "TestPass123!", csrfToken: csrfJson.csrfToken, callbackUrl: "/", json: "true" });
const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual" });
const loginCookies = (loginRes as any).headers.getSetCookie?.() || [];
const cookie = loginCookies.map((c: string) => c.split(";")[0]).join("; ");
// Get customers
const custRes = await fetch(`${BASE}/api/customers?pageSize=1`, { headers: { Cookie: cookie } });
const custData = await custRes.json();
const custId = custData.items?.[0]?.id;
// Create invoice with due date in past
const invRes = await fetch(`${BASE}/api/sales/invoices`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ customerId: custId, dueDate: new Date(Date.now() - 30 * 86400000).toISOString() }) });
const inv = await invRes.json();
console.log("Invoice created:", inv.id, inv.invoiceNumber, inv.status);
// Add item
await fetch(`${BASE}/api/sales/invoices/${inv.id}/items`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ description: "Overdue test", quantity: "1", unitPrice: "5000.00", discount: "0", taxRate: "0" }) });
// Issue
const issueRes = await fetch(`${BASE}/api/sales/invoices/${inv.id}/issue`, { method: "POST", headers: { Cookie: cookie } });
console.log("Issue status:", issueRes.status);
const issueData = await issueRes.json();
console.log("Issue response keys:", Object.keys(issueData));
console.log("Invoice status:", issueData.invoice?.status || issueData.status);
// Get invoice
const getRes = await fetch(`${BASE}/api/sales/invoices/${inv.id}`, { headers: { Cookie: cookie } });
const getData = await getRes.json();
console.log("GET invoice keys:", Object.keys(getData));
console.log("overdue:", getData.overdue);
console.log("status:", getData.status);
console.log("dueDate:", getData.dueDate);
console.log("balanceDue:", getData.balanceDue);
