/**
 * Whether a native graph backend can answer from here — the availability half
 * of the repository root in `nativeGraphTransport.ts`.
 */

import { isDesktopRuntime } from '#/utils/desktopBridge';

import { createDesktopNativeGraphTransport, type NativeGraphTransport } from './nativeGraphTransport';

export type NativeGraphAvailability =
    | Readonly<{ available: true; transport: NativeGraphTransport }>
    | Readonly<{
          available: false;
          reason: string;
          /**
           * Whether a native engine was ever on the table here: a browser
           * build has none, so its absence is the platform, not a
           * degradation; a desktop build whose addon does not answer is a
           * degradation the caller should surface.
           */
          runtime: 'browser' | 'desktop';
      }>;

/**
 * Two facts, both owned by this repository root: the desktop bridge exists
 * (browser builds have none), and the addon behind it answers the graph
 * command surface — proven by mapping an empty stateless batch, which builds
 * nothing, renders nothing and starts no engine. An addon that is missing,
 * stale, or refuses the probe answers `available: false` with the reason, so
 * the caller can degrade observably instead of exporting into an error.
 */
export async function probeNativeGraphTransport(): Promise<NativeGraphAvailability> {
    if (!isDesktopRuntime()) {
        return { available: false, reason: 'no desktop bridge (browser runtime)', runtime: 'browser' };
    }
    const transport = createDesktopNativeGraphTransport();
    try {
        await transport.mapGraphBatch({
            prior: [],
            batch: { schemaVersion: 1, commands: [] },
            sampleRate: 48_000,
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { available: false, reason: `native graph commands unavailable: ${reason}`, runtime: 'desktop' };
    }
    return { available: true, transport };
}
