/**
 * `/qoder-endpoint` — show or set the Qoder CN gateway endpoint.
 *
 * Qoder CN is served either from the public gateway or from a per-tenant
 * enterprise (VPC) instance. The endpoint is written to
 * `~/.pi/agent/qoder-cn-settings.json`, which `vpc.ts` reads on the next
 * resolve, so the choice survives a restart.
 *
 * Changing the endpoint also invalidates the cached model catalog: the
 * enterprise instance may expose a different model set than the public
 * gateway, and the cached ids/context windows would otherwise be stale.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getCachedCredentials } from "../auth/oauth.js";
import { updateQoderModelsCache } from "../catalog.js";
import { getQoderCNEndpoints, readInheritedVpcEndpoint, setQoderCNEndpoint } from "../vpc.js";

/** Values that reset to the official public gateway. */
const RESET_VALUES = new Set(["official", "default", "clear", "none", "reset"]);

/** Describe the active endpoint for the no-argument listing. */
export function describeEndpoint(): string {
  const current = getQoderCNEndpoints();
  if (current.isDefault) {
    return "Official Default Gateway (https://gateway.qoder.com.cn/)";
  }
  return `Enterprise Endpoint [${current.raw}]: ${current.baseUrl}`;
}

/**
 * Run `/qoder-endpoint [domain]`.
 *
 * With no argument it reports the active endpoint and the two forms that change
 * it. With an argument it switches and refreshes the model catalog in the
 * background so the next message sees the new instance's models.
 */
export async function runEndpointCommand(args: string, ctx?: ExtensionCommandContext): Promise<void> {
  const input = (args || "").trim();

  if (!input) {
    const inherited = readInheritedVpcEndpoint();
    const inheritedHint = inherited
      ? `\nDetected (not applied): ${inherited.value} from ${inherited.source} — run /qoder-endpoint ${inherited.value} to use it.`
      : "";
    ctx?.ui?.notify(
      `Current Qoder CN endpoint: ${describeEndpoint()}\nTo set: /qoder-endpoint <domain>\nTo reset: /qoder-endpoint default${inheritedHint}`,
      "info",
    );
    return;
  }

  try {
    const isReset = RESET_VALUES.has(input.toLowerCase());
    const resolved = setQoderCNEndpoint(isReset ? "" : input);

    ctx?.ui?.notify(
      isReset
        ? "Qoder CN endpoint reset to Official Default Gateway (https://gateway.qoder.com.cn/)"
        : `Qoder CN endpoint set to: ${resolved.baseUrl}`,
      "info",
    );

    // Best-effort: a failed refresh leaves the previous catalog in place, which
    // is better than dropping the user into an empty model list.
    const credentials = getCachedCredentials("", "qoder-cn");
    if (credentials?.access) {
      await updateQoderModelsCache(
        credentials.access,
        credentials.userID,
        credentials.name,
        credentials.email,
        "cn",
      ).catch(() => undefined);
      ctx?.ui?.notify("Qoder CN model catalog refreshed.", "info");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx?.ui?.notify(`Failed to set Qoder CN endpoint: ${message}`, "error");
  }
}
