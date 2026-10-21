import { decodeStretchMode, type WarpMarker, type WarpMarkerOrigin, type WarpState } from '../../models/WarpMarker';
import { type ClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { type ClipGainEnvelope, type GainEnvelopePoint } from '../../stores/gainEnvelopeStore';
import { isDefaultWarpState } from '../../stores/warpStates';

const ENTRY_KEYS = ['clipId', 'gainEnvelope', 'warpState'] as const;
const GAIN_ENVELOPE_KEYS = ['clipId', 'points', 'enabled'] as const;
const GAIN_ENVELOPE_POINT_KEYS = ['id', 'beatOffset', 'gainDb'] as const;
const WARP_STATE_KEYS = ['enabled', 'markers', 'stretchMode', 'originalTempo'] as const;
const WARP_MARKER_KEYS = ['id', 'originalBeat', 'warpedBeat', 'origin', 'confidence', 'locked'];
const WARP_MARKER_ORIGINS: readonly string[] = ['user', 'transient-auto', 'grid-snap'];

function isWarpMarkerOrigin(value: string): value is WarpMarkerOrigin {
    return WARP_MARKER_ORIGINS.includes(value);
}

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

/**
 * Rebuild a marker from validated fields rather than passing the input through.
 * An optional key whose value is `undefined` — which `createWarpMarker` writes
 * for `confidence` on every hand-placed marker — would otherwise survive into
 * the restore plan and break its canonical JSON round trip.
 */
function validateWarpMarker(value: unknown): WarpMarker | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return null;
    }

    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !WARP_MARKER_KEYS.includes(key)) {
            return null;
        }
    }
    const marker = value as Record<string, unknown>;
    if (!isNonEmptyString(marker.id) || !isFiniteNumber(marker.originalBeat) || !isFiniteNumber(marker.warpedBeat)) {
        return null;
    }

    const validated: WarpMarker = {
        id: marker.id,
        originalBeat: marker.originalBeat,
        warpedBeat: marker.warpedBeat,
    };
    if (marker.origin !== undefined) {
        if (typeof marker.origin !== 'string' || !isWarpMarkerOrigin(marker.origin)) {
            return null;
        }
        validated.origin = marker.origin;
    }
    if (marker.confidence !== undefined) {
        if (!isFiniteNumber(marker.confidence)) {
            return null;
        }
        validated.confidence = marker.confidence;
    }
    if (marker.locked !== undefined) {
        if (typeof marker.locked !== 'boolean') {
            return null;
        }
        validated.locked = marker.locked;
    }
    return validated;
}

function validateWarpState(value: unknown): WarpState | null | false {
    if (value === null) {
        return null;
    }

    const properties = readDataObject(value, WARP_STATE_KEYS);
    if (!properties || typeof properties.enabled !== 'boolean') {
        return false;
    }
    // `decodeStretchMode` is the same boundary the warp store sanitizes
    // through: canonical ids pass unchanged, a pre-ADR 0024 id an older undo
    // plan still carries maps onto its canonical mode, anything else refuses
    // the state. Comparing against the live store only works because both
    // sides land on the canonical vocabulary.
    const stretchMode = decodeStretchMode(properties.stretchMode);
    if (stretchMode === undefined) {
        return false;
    }
    const originalTempo: unknown = properties.originalTempo;
    if (originalTempo !== null && !isFiniteNumber(originalTempo)) {
        return false;
    }
    if (!Array.isArray(properties.markers)) {
        return false;
    }

    const markers: WarpMarker[] = [];
    for (const candidate of properties.markers) {
        const marker = validateWarpMarker(candidate);
        if (!marker) {
            return false;
        }
        markers.push(marker);
    }
    const state: WarpState = {
        enabled: properties.enabled,
        markers,
        stretchMode,
        originalTempo,
    };
    // The guarded write (`setWarpState`) and the live read
    // (`readClipSatelliteEntry`) both collapse a state equal to
    // `defaultWarpState` to absent — a legacy entry whose content decodes
    // onto the default (the retired `texture` mode, for one) must collapse
    // the same way here, or the expected side can never equal the live null
    // read and every replay of the plan refuses forever.
    return isDefaultWarpState(state) ? null : state;
}

function decodeEntries(value: unknown): ClipSatelliteEntry[] | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const clipIds = new Set<string>();
    const entries: ClipSatelliteEntry[] = [];
    for (const candidate of value) {
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
    return entries;
}

/** Shared saved-capture and time-operation decoder for complete clip satellites. */
export const clipSatelliteStateCodec = { readDataObject, decodeEntries };
