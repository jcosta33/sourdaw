import {
    type ClipSatelliteEntry,
    type ClipSatelliteSnapshot,
    type ClipSatelliteStateRestorePlan,
    readClipSatelliteEntry,
    writeClipSatelliteEntry,
} from '../../stores/clipSatelliteState';

import { timeOperationStateCodec } from './timeOperationStateCodec';

import type { WarpState } from '../../models/WarpMarker';
import type { ClipGainEnvelope, GainEnvelopePoint } from '../../stores/gainEnvelopeStore';

/**
 * Transactional owner for the per-clip satellite stores a global time operation
 * retires alongside the clips themselves: clip gain envelopes and warp states.
 *
 * The plan is scoped to the affected clip ids rather than to whole stores. A
 * whole-store guard would make undo conflict with any unrelated warp or
 * envelope edit made after the operation; a per-clip guard only rejects when
 * the very entries being restored moved underneath us.
 *
 * Clip-scoped automation lanes are deliberately absent. They live in
 * Automation's store, which already joins the same transaction through
 * `prepareAutomationTimeOperation`; a second handle writing that store would
 * find a stale captured reference and refuse to publish.
 */
type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

const PLAN_KEYS = ['version', 'expected', 'replacement'] as const;
const SNAPSHOT_KEYS = ['version', 'entries'] as const;
const ENTRY_KEYS = ['clipId', 'gainEnvelope', 'warpState'] as const;
const GAIN_ENVELOPE_KEYS = ['clipId', 'points', 'enabled'] as const;
const GAIN_ENVELOPE_POINT_KEYS = ['id', 'beatOffset', 'gainDb'] as const;
const WARP_STATE_KEYS = ['enabled', 'markers', 'stretchMode', 'originalTempo'] as const;
const WARP_MARKER_KEYS = ['id', 'originalBeat', 'warpedBeat', 'origin', 'confidence', 'locked'];
const WARP_MARKER_ORIGINS = ['user', 'transient-auto', 'grid-snap'];
const STRETCH_MODES = ['repitch', 'complex', 'texture', 'beats'];

function readDataObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return null;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length) {
        return null;
    }

    const expectedKeySet = new Set(expectedKeys);
    const properties: Record<string, unknown> = {};
    for (const ownKey of ownKeys) {
        if (typeof ownKey !== 'string' || !expectedKeySet.has(ownKey)) {
            return null;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }
        properties[ownKey] = descriptor.value;
    }
    return properties;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function validateGainEnvelope(value: unknown, clipId: string): ClipGainEnvelope | null | false {
    if (value === null) {
        return null;
    }

    const properties = readDataObject(value, GAIN_ENVELOPE_KEYS);
    if (!properties || properties.clipId !== clipId || typeof properties.enabled !== 'boolean') {
        return false;
    }
    const candidatePoints: unknown = properties.points;
    if (!Array.isArray(candidatePoints)) {
        return false;
    }

    const points: GainEnvelopePoint[] = [];
    for (const point of candidatePoints) {
        const pointProperties = readDataObject(point, GAIN_ENVELOPE_POINT_KEYS);
        if (
            !pointProperties ||
            !isNonEmptyString(pointProperties.id) ||
            !isFiniteNumber(pointProperties.beatOffset) ||
            !isFiniteNumber(pointProperties.gainDb)
        ) {
            return false;
        }
        points.push({
            id: pointProperties.id,
            beatOffset: pointProperties.beatOffset,
            gainDb: pointProperties.gainDb,
        });
    }
    return { clipId, enabled: properties.enabled, points };
}

function validateWarpMarker(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return false;
    }

    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !WARP_MARKER_KEYS.includes(key)) {
            return false;
        }
    }
    const marker = value as Record<string, unknown>;
    if (!isNonEmptyString(marker.id) || !isFiniteNumber(marker.originalBeat) || !isFiniteNumber(marker.warpedBeat)) {
        return false;
    }
    if (marker.origin !== undefined) {
        if (typeof marker.origin !== 'string' || !WARP_MARKER_ORIGINS.includes(marker.origin)) {
            return false;
        }
    }
    if (marker.confidence !== undefined && !isFiniteNumber(marker.confidence)) {
        return false;
    }
    return marker.locked === undefined || typeof marker.locked === 'boolean';
}

function validateWarpState(value: unknown): WarpState | null | false {
    if (value === null) {
        return null;
    }

    const properties = readDataObject(value, WARP_STATE_KEYS);
    if (!properties || typeof properties.enabled !== 'boolean') {
        return false;
    }
    if (typeof properties.stretchMode !== 'string' || !STRETCH_MODES.includes(properties.stretchMode)) {
        return false;
    }
    if (properties.originalTempo !== null && !isFiniteNumber(properties.originalTempo)) {
        return false;
    }
    if (!Array.isArray(properties.markers) || !properties.markers.every(validateWarpMarker)) {
        return false;
    }
    return value as WarpState;
}

function validateSnapshot(value: unknown): ClipSatelliteSnapshot | null {
    const properties = readDataObject(value, SNAPSHOT_KEYS);
    if (!properties || properties.version !== 1 || !Array.isArray(properties.entries)) {
        return null;
    }

    const clipIds = new Set<string>();
    const entries: ClipSatelliteEntry[] = [];
    for (const candidate of properties.entries) {
        const entry = readDataObject(candidate, ENTRY_KEYS);
        if (!entry || !isNonEmptyString(entry.clipId) || clipIds.has(entry.clipId)) {
            return null;
        }
        const gainEnvelope = validateGainEnvelope(entry.gainEnvelope, entry.clipId);
        const warpState = validateWarpState(entry.warpState);
        if (gainEnvelope === false || warpState === false) {
            return null;
        }
        clipIds.add(entry.clipId);
        entries.push({ clipId: entry.clipId, gainEnvelope, warpState });
    }
    return { version: 1, entries };
}

function validatePlan(value: unknown): ClipSatelliteStateRestorePlan | null {
    const properties = readDataObject(value, PLAN_KEYS);
    if (!properties || properties.version !== 1) {
        return null;
    }

    const expected = validateSnapshot(properties.expected);
    const replacement = validateSnapshot(properties.replacement);
    if (!expected || !replacement || expected.entries.length !== replacement.entries.length) {
        return null;
    }
    // Both sides must address the same clip ids in the same order, so `apply`
    // and `revert` write exactly the entries the guard checked.
    for (const [index, entry] of expected.entries.entries()) {
        if (replacement.entries[index]?.clipId !== entry.clipId) {
            return null;
        }
    }
    return { version: 1, expected, replacement };
}

function snapshotMatchesStores(snapshot: ClipSatelliteSnapshot): boolean {
    for (const entry of snapshot.entries) {
        const current = readClipSatelliteEntry(entry.clipId);
        if (!timeOperationStateCodec.valuesEqual(current.gainEnvelope, entry.gainEnvelope)) {
            return false;
        }
        if (!timeOperationStateCodec.valuesEqual(current.warpState, entry.warpState)) {
            return false;
        }
    }
    return true;
}

function rejectedPreparation() {
    return {
        status: 'rejected' as const,
        hasChanges: false,
        apply: () => false,
        revert: () => false,
    };
}

/**
 * Prepare a satellite transition. Used in both directions: forward by
 * `executeGlobalTimeOperation` (live satellites to cleared) and backward by
 * `prepareTimeOperationStateRestore` for undo and redo.
 */
export function prepareClipSatelliteStateRestore(value: unknown): {
    status: 'ready' | 'rejected';
    hasChanges: boolean;
    apply: () => boolean;
    revert: () => boolean;
} {
    const validatedPlan = validatePlan(value);
    if (!validatedPlan) {
        return rejectedPreparation();
    }
    const expectedSnapshot = validatedPlan.expected;
    const replacementSnapshot = validatedPlan.replacement;
    if (!snapshotMatchesStores(expectedSnapshot)) {
        return rejectedPreparation();
    }

    const hasChanges = !timeOperationStateCodec.valuesEqual(expectedSnapshot.entries, replacementSnapshot.entries);
    let phase: TransactionPhase = 'closed';
    if (hasChanges) {
        phase = 'prepared';
    }

    function publish(from: ClipSatelliteSnapshot, to: ClipSatelliteSnapshot, nextPhase: 'applied' | 'closed'): boolean {
        if (!snapshotMatchesStores(from)) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            for (const entry of to.entries) {
                writeClipSatelliteEntry(entry);
            }
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (!snapshotMatchesStores(to)) {
            phase = 'closed';
            return false;
        }
        phase = nextPhase;
        return true;
    }

    function apply(): boolean {
        if (phase !== 'prepared') {
            phase = 'closed';
            return false;
        }
        return publish(expectedSnapshot, replacementSnapshot, 'applied');
    }

    function revert(): boolean {
        if (phase !== 'applied') {
            phase = 'closed';
            return false;
        }
        return publish(replacementSnapshot, expectedSnapshot, 'closed');
    }

    return {
        status: 'ready',
        hasChanges,
        apply,
        revert,
    };
}
