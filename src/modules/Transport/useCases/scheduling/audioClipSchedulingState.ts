/**
 * §109.1 — Holder-wrapped dedup Set. Hashes for which we have already
 * sent a peer request this session. Prevents spamming requestAsset()
 * every scheduler tick while waiting.
 */
export const sessionState: { requestedAssets: Set<string> } = {
    requestedAssets: new Set<string>(),
};

/**
 * Global pool for GainNodes to prevent main-thread GC allocations
 * during high-frequency audio scheduling ticks.
 */
export const gainNodePool: GainNode[] = [];
