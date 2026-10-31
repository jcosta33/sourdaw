import { type MidiTakeSourceSnapshot } from '#/utils/handlerContract';

import { isExactMidiClipDataActionSnapshot } from '../services/isExactMidiClipDataActionSnapshot';

export type FrozenMidiTakeSource = MidiTakeSourceSnapshot;

function isFiniteBeat(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

// String keys only: a source read back from the project document carries the
// CRDT's own symbol-keyed object metadata, which is not content.
function hasExactSourceKeys(value: object): boolean {
    const keys = Object.keys(value);
    const allowed = ['sourceClipId', 'rows', 'sourceEntryBeat', 'sourceEndBeat', 'phaseHeadBeat', 'passLengthBeats'];
    return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

/** Presence is authoritative: an absent legacy source is handled by the caller. */
export function isFrozenMidiTakeSource(value: unknown): value is FrozenMidiTakeSource {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!hasExactSourceKeys(value)) {
        return false;
    }
    if (!('sourceClipId' in value) || typeof value.sourceClipId !== 'string' || value.sourceClipId.length === 0) {
        return false;
    }
    if (!('rows' in value) || !isExactMidiClipDataActionSnapshot(value.rows)) {
        return false;
    }
    if (
        !('sourceEntryBeat' in value) ||
        !isFiniteBeat(value.sourceEntryBeat) ||
        !('sourceEndBeat' in value) ||
        !isFiniteBeat(value.sourceEndBeat) ||
        value.sourceEndBeat <= value.sourceEntryBeat ||
        !('phaseHeadBeat' in value) ||
        !isFiniteBeat(value.phaseHeadBeat) ||
        !('passLengthBeats' in value) ||
        !isFiniteBeat(value.passLengthBeats) ||
        value.passLengthBeats <= 0
    ) {
        return false;
    }
    return value.sourceEndBeat - value.sourceEntryBeat <= value.passLengthBeats;
}
