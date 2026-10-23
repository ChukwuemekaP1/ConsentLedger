export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installResilientDns } = await import("./infrastructure/config/dns.js");
    installResilientDns();
  }
}
