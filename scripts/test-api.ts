/**
 * Test script for API endpoints
 * Usage: npx tsx scripts/test-api.ts
 *
 * A manual smoke script (not part of the automated test suite): it expects an API
 * server already running at BASE_URL and exits 1 if a request throws. It only
 * prints the HTTP status and body; it does not assert on them.
 * Note: app.ts mounts auth routes under /api/v1 and /v1, so the unprefixed
 * /auth/register path used below may not match a route.
 */

const BASE_URL = "http://localhost:3000";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testRegister() {
  console.log("\n=== Testing POST /auth/register ===");

  const response = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "debug@test.com",
      password: "password123",
    }),
  });

  console.log("Status:", response.status);
  const data = await response.json();
  console.log("Response:", JSON.stringify(data, null, 2));
  return data;
}

async function runTests() {
  console.log("Waiting for server to be ready...");
  await delay(3000);

  try {
    await testRegister();
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }

  console.log("\n✅ All tests completed");
  process.exit(0);
}

runTests();
