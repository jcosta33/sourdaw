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
    const required = ['sourceClipId', 'rows', 'sourceEntryBeat', 'sourceEndBeat', 'phaseHeadBeat', 'passLengthBeats'];
    const allowed = [...required, 'runUpEntryBeat'];
    return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.includes(key));
}

/** A present run-up starts strictly before the take's own entry; a run-up of nothing is written as absence. */
function hasValidRunUp(value: { readonly sourceEntryBeat: number }): boolean {
    if (!('runUpEntryBeat' in value)) {
        return true;
    }
    return isFiniteBeat(value.runUpEntryBeat) && value.runUpEntryBeat < value.sourceEntryBeat;
}

/** A non-empty source span no longer than the pass it repeats at, and a run-up before it. */
function hasValidPassGeometry(value: object): boolean {
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
    return value.sourceEndBeat - value.sourceEntryBeat <= value.passLengthBeats && hasValidRunUp(value);
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
    return hasValidPassGeometry(value);
}
