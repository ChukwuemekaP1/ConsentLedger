/**
 * Resilient DNS configuration with fast public DNS resolvers.
 *
 * Windows local ISP / router DNS frequently hangs or times out with EAI_AGAIN
 * on cloud services (Neon, Channel3, Gemini, PayPal).
 * Proactively resolves these domains via Google / Cloudflare DNS in milliseconds.
 */

import dns from "node:dns";

let installed = false;

const DIRECT_RESOLVE_HOSTS: readonly string[] = [
  "neon.tech",
  "trychannel3.com",
  "googleapis.com",
  "paypal.com",
];

export function installResilientDns(): void {
  if (installed) return;
  installed = true;

  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    // ignore
  }

  const origLookup = dns.lookup;
  const resolver = new dns.Resolver();
  resolver.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);

  const patchedLookup: typeof dns.lookup = ((
    hostname: string,
    optionsOrCallback?:
      | dns.LookupOptions
      | number
      | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
    callbackOrUndefined?: (
      err: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    let opts: dns.LookupOptions = {};
    let cb: (
      err: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void;

    if (typeof optionsOrCallback === "function") {
      cb = (err, address, family) => {
        const addrStr = typeof address === "string" ? address : (address[0]?.address ?? "");
        optionsOrCallback(err, addrStr, family ?? 4);
      };
    } else {
      if (typeof optionsOrCallback === "object") {
        opts = optionsOrCallback;
      } else if (typeof optionsOrCallback === "number") {
        opts = { family: optionsOrCallback };
      }
      cb = (err, address, family) => {
        callbackOrUndefined?.(err, address, family);
      };
    }

    if (
      typeof hostname === "string" &&
      DIRECT_RESOLVE_HOSTS.some((pattern) => hostname.includes(pattern))
    ) {
      resolver.resolve4(hostname, (err, addrs) => {
        if (!err && addrs.length > 0) {
          if (opts.all) {
            cb(
              null,
              addrs.map((a) => ({ address: a, family: 4 })),
            );
          } else {
            cb(null, addrs[0] ?? "", 4);
          }
          return;
        }
        (origLookup as (...args: unknown[]) => void)(hostname, opts, cb);
      });
      return;
    }

    (origLookup as (...args: unknown[]) => void)(
      hostname,
      opts,
      (
        err: NodeJS.ErrnoException | null,
        address: string | dns.LookupAddress[],
        family?: number,
      ) => {
        if (
          err &&
          (err.code === "EAI_AGAIN" || err.code === "ENOTFOUND" || err.code === "ETIMEOUT") &&
          typeof hostname === "string"
        ) {
          resolver.resolve4(hostname, (resErr, addrs) => {
            if (resErr || addrs.length === 0) {
              cb(err, address, family);
            } else if (opts.all) {
              cb(
                null,
                addrs.map((a) => ({ address: a, family: 4 })),
              );
            } else {
              cb(null, addrs[0] ?? "", 4);
            }
          });
          return;
        }
        cb(err, address, family);
      },
    );
  }) as unknown as typeof dns.lookup;

  dns.lookup = patchedLookup;
}
