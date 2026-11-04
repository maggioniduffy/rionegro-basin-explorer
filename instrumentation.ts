export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Node 24's happy-eyeballs attempt timeout (250 ms) is shorter than a slow TCP
    // connect (~350 ms on some networks), so outbound fetches (Open-Meteo) fail with
    // ETIMEDOUT. Give each connection attempt 2000 ms.
    const net = await import("node:net");
    net.setDefaultAutoSelectFamilyAttemptTimeout(2000);
  }
}
