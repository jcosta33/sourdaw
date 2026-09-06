import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

function isCompleteGeneratedMidiStateGuard(value: unknown, entityId: string): boolean {
    if (
        !isRecord(value) ||
        Object.keys(value).length !== 2 ||
        typeof value.entityJson !== 'string' ||
        typeof value.midiByClipIdJson !== 'string'
    ) {
        return false;
    }
    try {
        const entity: unknown = JSON.parse(value.entityJson);
        const midiByClipId: unknown = JSON.parse(value.midiByClipIdJson);
        return isRecord(entity) && entity.id === entityId && isRecord(midiByClipId);
    } catch {
        return false;
    }
}

export function isAddTrackSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'addTrack' ||
        entry.inverseAction?.type !== 'discardCreatedTrack' ||
        entry.redoAction !== undefined
    ) {
        return false;
    }
    const trackId = entry.action.payload.id;
    return (
        typeof trackId === 'string' &&
        trackId.length > 0 &&
        entry.inverseAction.payload.trackId === trackId &&
        isCompleteGeneratedMidiStateGuard(entry.inverseAction.payload.generatedMidiStateGuard, trackId)
    );
}

export function isAddClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'addClip' ||
        entry.inverseAction?.type !== 'discardDuplicatedClip' ||
        entry.redoAction?.type !== 'addClip'
    ) {
        return false;
    }
    const clipId = entry.inverseAction.payload.clipId;
    if (
        clipId.length === 0 ||
        (entry.action.payload.id !== undefined && entry.action.payload.id !== clipId) ||
        !isCompleteGeneratedMidiStateGuard(entry.inverseAction.payload.generatedMidiStateGuard, clipId)
    ) {
        return false;
    }
    return valuesEqual(entry.redoAction.payload, { ...entry.action.payload, id: clipId });
}

function isNonNegativeBeat(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

function isForwardBeatSpan(startBeat: number, endBeat: number): boolean {
    return (
        Number.isFinite(startBeat) && isNonNegativeBeat(startBeat) && Number.isFinite(endBeat) && endBeat > startBeat
    );
}

type DrawClipActionPayload = Extract<AppAction, { type: 'drawClip' }>['payload'];
type DiscardDrawnClipPayload = Extract<AppAction, { type: 'discardDrawnClip' }>['payload'];
type RestoreDrawnClipPayload = Extract<AppAction, { type: 'restoreDrawnClip' }>['payload'];

/** Cross-half consistency the argument contracts cannot see: both halves carry
 *  the same clip identity, geometry, and captured ripple plan. */
function drawClipHalvesAgree(
    action: DrawClipActionPayload,
    inverse: DiscardDrawnClipPayload,
    redo: RestoreDrawnClipPayload
): boolean {
    if (action.id !== undefined && action.id !== inverse.clipId) {
        return false;
    }
    if (inverse.clipId.length === 0 || inverse.trackId !== action.trackId) {
        return false;
    }
    return (
        redo.clipId === inverse.clipId &&
        redo.trackId === action.trackId &&
        redo.startBeat === action.startBeat &&
        redo.endBeat === action.endBeat &&
        redo.name === action.name &&
        redo.type === action.type &&
        valuesEqual(inverse.ripplePlan, redo.ripplePlan)
    );
}

export function isDrawClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'drawClip' ||
        entry.inverseAction?.type !== 'discardDrawnClip' ||
        entry.redoAction?.type !== 'restoreDrawnClip'
    ) {
        return false;
    }
    const action = entry.action.payload;
    if (
        action.trackId.length === 0 ||
        !isForwardBeatSpan(action.startBeat, action.endBeat) ||
        typeof action.ripple !== 'boolean'
    ) {
        return false;
    }
    return drawClipHalvesAgree(action, entry.inverseAction.payload, entry.redoAction.payload);
}

export function isDuplicateClipAtSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'duplicateClipAt' ||
        entry.inverseAction?.type !== 'discardDuplicatedClip' ||
        entry.redoAction !== undefined
    ) {
        return false;
    }
    const action = entry.action.payload;
    if (
        action.clipId.length === 0 ||
        action.destinationTrackId.length === 0 ||
        !Number.isFinite(action.startBeat) ||
        action.startBeat < 0
    ) {
        return false;
    }
    const copyId = entry.inverseAction.payload.clipId;
    // Materialization pins the copy id into the payload before the write is
    // recorded, so a persisted entry always names the exact copy its inverse
    // removes — the addClip `id === inverse clip id` bar, on this action's own
    // field.
    return typeof action.targetClipId === 'string' && action.targetClipId.length > 0 && action.targetClipId === copyId;
}

export function isMoveClipsSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'moveClips' ||
        entry.inverseAction?.type !== 'restoreClipMoves' ||
        entry.redoAction !== undefined
    ) {
        return false;
    }
    const action = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    if (typeof action.ripple !== 'boolean' || action.moves.length === 0) {
        return false;
    }
    const requestedClipIds = new Set<string>();
    for (const move of action.moves) {
        if (
            move.clipId.length === 0 ||
            move.trackId.length === 0 ||
            !Number.isFinite(move.startBeat) ||
            move.startBeat < 0
        ) {
            return false;
        }
        requestedClipIds.add(move.clipId);
    }
    // The inverse may only restore clips the recorded move requested; the
    // neighbor shifts may name any clip (a later move's plan can shift an
    // earlier-moved clip), and their payload shape is contract-enforced.
    for (const restored of inverse.movedClips) {
        if (
            !requestedClipIds.has(restored.clipId) ||
            restored.trackId.length === 0 ||
            !Number.isFinite(restored.startBeat) ||
            restored.startBeat < 0
        ) {
            return false;
        }
    }
    return true;
}
