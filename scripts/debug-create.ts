const BASE = "http://localhost:3000";
// Login first
const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
const csrfToken = (await csrfRes.json()).csrfToken;
const csrfCookies = (csrfRes as any).headers.getSetCookie?.() || [];
const csrfCookieStr = csrfCookies.map((c: string) => c.split(";")[0]).join("; ");
const body = new URLSearchParams({ email: "md@phase7.test", password: "TestPass123!", csrfToken, callbackUrl: "/", json: "true" });
const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookieStr }, body, redirect: "manual" });
const loginCookies = (loginRes as any).headers.getSetCookie?.() || [];
const allCookies = loginCookies.map((c: string) => c.split(";")[0]).join("; ");

// Get reference data
const supRes = await fetch(`${BASE}/api/suppliers?pageSize=5`, { headers: { Cookie: allCookies } });
const suppliers = (await supRes.json()).items || [];
const projRes = await fetch(`${BASE}/api/projects?pageSize=5`, { headers: { Cookie: allCookies } });
const projects = (await projRes.json()).items || [];
const staffRes = await fetch(`${BASE}/api/staff?pageSize=5`, { headers: { Cookie: allCookies } });
const employees = (await staffRes.json()).items || [];

console.log("First supplier:", suppliers[0]?.id, suppliers[0]?.tradingName);
console.log("First project:", projects[0]?.id, projects[0]?.name, projects[0]?.status);
console.log("First employee:", employees[0]?.id, employees[0]?.fullName);

// Try to create a procurement request
const createBody = {
  title: "Test procurement request",
  requesterId: employees[0]?.id,
  supplierId: suppliers[0]?.id,
  projectId: projects[0]?.id,
  priority: "high",
  requiredByDate: new Date(Date.now() + 7 * 86400000).toISOString(),
  notes: "Test",
};
console.log("\nCreate body:", JSON.stringify(createBody));

const createRes = await fetch(`${BASE}/api/procurement/requests`, {
  method: "POST",
  headers: { Cookie: allCookies, "Content-Type": "application/json" },
  body: JSON.stringify(createBody),
});
console.log("\nCreate status:", createRes.status);
const createText = await createRes.text();
console.log("Create response:", createText);
