import { type ClipGainEnvelope, getEnvelope, removeEnvelope, setEnvelope } from './gainEnvelopeStore';
import { removeWarpState, setWarpState, warpStates } from './warpStates';

import type { WarpState } from '../models/WarpMarker';

/**
 * Read/write surface for the per-clip satellite records a clip carries besides
 * its rectangle: the gain envelope and the warp state. Lives in `stores/` (not
 * `useCases/`) so the transactional owner and the imperative cleanup path share
 * one definition of what a clip's satellites are, without either pulling the
 * other's graph.
 *
 * Clip-scoped automation lanes are Automation's, not Arrangement's, and are not
 * part of this shape.
 */
export type ClipSatelliteEntry = {
    clipId: string;
    gainEnvelope: ClipGainEnvelope | null;
    warpState: WarpState | null;
};

export type ClipSatelliteSnapshot = {
    version: 1;
    entries: readonly ClipSatelliteEntry[];
};

export type ClipSatelliteStateRestorePlan = {
    version: 1;
    expected: ClipSatelliteSnapshot;
    replacement: ClipSatelliteSnapshot;
};

/** The live satellites of one clip id; `null` where the clip carries none. */
export function readClipSatelliteEntry(clipId: string): ClipSatelliteEntry {
    return {
        clipId,
        gainEnvelope: getEnvelope(clipId) ?? null,
        warpState: warpStates.get(clipId) ?? null,
    };
}

/**
 * Publish one entry. A `null` member removes the record rather than storing an
 * empty one, so a restored clip with no envelope is indistinguishable from a
 * clip that never had one.
 */
export function writeClipSatelliteEntry(entry: ClipSatelliteEntry): void {
    if (entry.gainEnvelope === null) {
        removeEnvelope(entry.clipId);
    } else {
        setEnvelope(entry.clipId, structuredClone(entry.gainEnvelope));
    }
    if (entry.warpState === null) {
        removeWarpState(entry.clipId);
    } else {
        setWarpState(entry.clipId, structuredClone(entry.warpState));
    }
}

/**
 * The transition that retires the satellites of the given clip ids: `expected`
 * is what the stores hold now, `replacement` clears it. Clip ids that carry no
 * satellite are left out entirely, so an operation that retires only bare clips
 * produces an unchanged plan the transaction skips.
 */
export function createClipSatelliteRemovalPlan(clipIds: readonly string[]): ClipSatelliteStateRestorePlan {
    const seen = new Set<string>();
    const captured: ClipSatelliteEntry[] = [];
    const cleared: ClipSatelliteEntry[] = [];
    for (const clipId of clipIds) {
        if (seen.has(clipId)) {
            continue;
        }
        seen.add(clipId);
        const entry = readClipSatelliteEntry(clipId);
        if (entry.gainEnvelope === null && entry.warpState === null) {
            continue;
        }
        captured.push(structuredClone(entry));
        cleared.push({ clipId, gainEnvelope: null, warpState: null });
    }

    return {
        version: 1,
        expected: { version: 1, entries: captured },
        replacement: { version: 1, entries: cleared },
    };
}
