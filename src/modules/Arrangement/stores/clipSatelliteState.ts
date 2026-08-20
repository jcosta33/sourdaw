import {
    type ClipSatelliteEntrySnapshot,
    type ClipSatelliteGainEnvelopeSnapshot,
    type ClipSatelliteWarpMarkerSnapshot,
    type ClipSatelliteWarpStateSnapshot,
} from '#/utils/handlerContract';

import { type ClipGainEnvelope, getEnvelope, removeEnvelope, setEnvelope } from './gainEnvelopeStore';
import { removeWarpState, setWarpState, warpStates } from './warpStates';

import type { WarpMarker, WarpState } from '../models/WarpMarker';

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

/** A clip id an operation re-keys: the record moves, it is not destroyed. */
export type ClipSatelliteMigration = {
    sourceClipId: string;
    targetClipId: string;
};

export type ClipSatelliteTransition = {
    /** Clip ids leaving the arrangement outright; their satellites go too. */
    removedClipIds: readonly string[];
    /** Clip ids surviving under a new id; their satellites follow the clip. */
    migrations: readonly ClipSatelliteMigration[];
};

/**
 * Rebuild a marker with only the optional keys that actually carry a value.
 *
 * `createWarpMarker` writes `confidence: options?.confidence` unconditionally,
 * so a hand-placed marker owns a `confidence` key whose value is `undefined`.
 * A plan carrying that key survives `structuredClone` but not the canonical
 * JSON round trip the inverse-plan encoder verifies, which would push the whole
 * owner plan onto the opaque encoding path. Dropping the key at capture keeps
 * every satellite plan plain JSON.
 */
function normalizeWarpMarker(marker: ClipSatelliteWarpMarkerSnapshot): WarpMarker {
    const normalized: WarpMarker = {
        id: marker.id,
        originalBeat: marker.originalBeat,
        warpedBeat: marker.warpedBeat,
    };
    if (marker.origin !== undefined) {
        normalized.origin = marker.origin;
    }
    if (marker.confidence !== undefined) {
        normalized.confidence = marker.confidence;
    }
    if (marker.locked !== undefined) {
        normalized.locked = marker.locked;
    }
    return normalized;
}

function normalizeWarpState(state: ClipSatelliteWarpStateSnapshot): WarpState {
    return {
        enabled: state.enabled,
        markers: state.markers.map(normalizeWarpMarker),
        stretchMode: state.stretchMode,
        originalTempo: state.originalTempo,
    };
}

function normalizeGainEnvelope(envelope: ClipSatelliteGainEnvelopeSnapshot, clipId: string): ClipGainEnvelope {
    return {
        clipId,
        points: envelope.points.map((point) => ({
            id: point.id,
            beatOffset: point.beatOffset,
            gainDb: point.gainDb,
        })),
        enabled: envelope.enabled,
    };
}

/**
 * The live satellites of one clip id; `null` where the clip carries none. Every
 * record is rebuilt field by field, so a snapshot never inherits an own key
 * whose value is `undefined` from whoever wrote the store.
 */
export function readClipSatelliteEntry(clipId: string): ClipSatelliteEntry {
    const gainEnvelope = getEnvelope(clipId);
    const warpState = warpStates.get(clipId);
    return {
        clipId,
        gainEnvelope: gainEnvelope ? normalizeGainEnvelope(gainEnvelope, clipId) : null,
        warpState: warpState ? normalizeWarpState(warpState) : null,
    };
}

/**
 * Publish one entry. A `null` member removes the record rather than storing an
 * empty one, so a restored clip with no envelope is indistinguishable from a
 * clip that never had one.
 */
export function writeClipSatelliteEntry(entry: ClipSatelliteEntrySnapshot): void {
    if (entry.gainEnvelope === null) {
        removeEnvelope(entry.clipId);
    } else {
        setEnvelope(entry.clipId, normalizeGainEnvelope(entry.gainEnvelope, entry.clipId));
    }
    if (entry.warpState === null) {
        removeWarpState(entry.clipId);
    } else {
        setWarpState(entry.clipId, normalizeWarpState(entry.warpState));
    }
}

function emptyEntry(clipId: string): ClipSatelliteEntry {
    return { clipId, gainEnvelope: null, warpState: null };
}

function movedEntry(entry: ClipSatelliteEntry, targetClipId: string): ClipSatelliteEntry {
    return {
        clipId: targetClipId,
        gainEnvelope: entry.gainEnvelope ? normalizeGainEnvelope(entry.gainEnvelope, targetClipId) : null,
        warpState: entry.warpState,
    };
}

/**
 * The transition that retires or re-keys the satellites of the given clip ids:
 * `expected` is what the stores hold now, `replacement` is what they hold after
 * the operation. Clip ids that carry no satellite are left out entirely, so an
 * operation touching only bare clips produces an unchanged plan the transaction
 * skips.
 *
 * A migration addresses both ends: the source is cleared and the target is
 * written, with the envelope re-keyed to the target id. The target's `expected`
 * side is empty, so a target id that somehow already carries satellites makes
 * the preparation reject instead of overwriting them.
 *
 * Returns `null` when the transition addresses one clip id twice — that would
 * make the outcome depend on entry order, and the caller must refuse rather
 * than pick one.
 */
export function createClipSatelliteTransitionPlan(
    transition: ClipSatelliteTransition
): ClipSatelliteStateRestorePlan | null {
    const addressed = new Set<string>();
    const captured: ClipSatelliteEntry[] = [];
    const cleared: ClipSatelliteEntry[] = [];

    for (const clipId of transition.removedClipIds) {
        if (addressed.has(clipId)) {
            return null;
        }
        addressed.add(clipId);
        const entry = readClipSatelliteEntry(clipId);
        if (entry.gainEnvelope === null && entry.warpState === null) {
            continue;
        }
        captured.push(entry);
        cleared.push(emptyEntry(clipId));
    }

    for (const migration of transition.migrations) {
        if (addressed.has(migration.sourceClipId) || addressed.has(migration.targetClipId)) {
            return null;
        }
        addressed.add(migration.sourceClipId);
        addressed.add(migration.targetClipId);
        const entry = readClipSatelliteEntry(migration.sourceClipId);
        if (entry.gainEnvelope === null && entry.warpState === null) {
            continue;
        }
        captured.push(entry, emptyEntry(migration.targetClipId));
        cleared.push(emptyEntry(migration.sourceClipId), movedEntry(entry, migration.targetClipId));
    }

    return {
        version: 1,
        expected: { version: 1, entries: captured },
        replacement: { version: 1, entries: cleared },
    };
}
