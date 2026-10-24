#!/usr/bin/env node
/** Wait for the local service health endpoint and fail with a readable message. */
const url = process.env.HEALTH_URL || "http://127.0.0.1:36080/api/health";
const attempts = Number(process.env.HEALTH_ATTEMPTS || 40);
const delayMs = Number(process.env.HEALTH_DELAY_MS || 1500);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (response.ok) {
      const body = await response.json();
      if (body.ok === true && body.service === "knowledge-base") {
        console.log(`[health] ok after ${attempt} attempt(s):`, JSON.stringify(body));
        process.exit(0);
      }
      console.error(`[health] attempt ${attempt}: unexpected service response`);
    }
    console.error(`[health] attempt ${attempt}: HTTP ${response.status}`);
  } catch (error) {
    console.error(`[health] attempt ${attempt}: ${error.message}`);
  }
  await sleep(delayMs);
}

console.error(`[health] service did not become healthy after ${attempts} attempts: ${url}`);
process.exit(1);
