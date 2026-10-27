import { isMidiRowCoordinateCapture } from '#/modules/MIDI/useCases';
import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

type RowAction = Extract<AppAction, { type: 'slipClipContent' | 'trimClipStart' }>;
type Capture = NonNullable<RowAction['payload']['midiRowCoordinates']>;
type Pair = { action: RowAction; inverseAction: RowAction; redoAction: RowAction };

function isRowAction(action: AppAction | null | undefined): action is RowAction {
    return action?.type === 'slipClipContent' || action?.type === 'trimClipStart';
}
function hasCapture(action: RowAction): boolean {
    return Object.hasOwn(action.payload, 'midiRowCoordinates');
}
function isFiniteBeat(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
function reverseCapture(capture: Capture): Capture {
    return {
        beatDelta: -capture.beatDelta,
        coordinates: capture.coordinates.map((row) => ({
            ...row,
            beforeBeat: row.afterBeat,
            afterBeat: row.beforeBeat,
        })),
    };
}
function isSlipPairCoherent(pair: Pair, inverseCapture: Capture, originalCapture: Capture | undefined): boolean {
    const { action, inverseAction: inverse, redoAction: redo } = pair;
    if (action.type === 'slipClipContent' && inverse.type === 'slipClipContent' && redo.type === 'slipClipContent') {
        return (
            action.payload.clipType === 'midi' &&
            inverse.payload.clipType === 'midi' &&
            redo.payload.clipType === 'midi' &&
            isFiniteBeat(action.payload.offset) &&
            isFiniteBeat(inverse.payload.offset) &&
            isFiniteBeat(inverse.payload.rowLiftBeats) &&
            inverse.payload.rowLiftBeats === -inverseCapture.beatDelta &&
            (!hasCapture(action) ||
                (isFiniteBeat(action.payload.rowLiftBeats) &&
                    action.payload.rowLiftBeats === -originalCapture!.beatDelta))
        );
    }
    return false;
}

function isTrimPairCoherent(pair: Pair, inverseCapture: Capture): boolean {
    const { action, inverseAction: inverse } = pair;
    if (action.type === 'trimClipStart' && inverse.type === 'trimClipStart') {
        const startDelta = Math.max(0, action.payload.newStartBeat) - inverse.payload.newStartBeat;
        const previousOffset = inverse.payload.midiOffsetBeats;
        return (
            isFiniteBeat(action.payload.newStartBeat) &&
            isFiniteBeat(inverse.payload.newStartBeat) &&
            inverse.payload.newStartBeat >= 0 &&
            Object.hasOwn(inverse.payload, 'loopOriginBeat') &&
            (inverse.payload.loopOriginBeat === null || isFiniteBeat(inverse.payload.loopOriginBeat)) &&
            isFiniteBeat(previousOffset) &&
            isFiniteBeat(startDelta) &&
            (!hasCapture(action) ||
                (isFiniteBeat(action.payload.midiOffsetBeats) &&
                    Object.hasOwn(action.payload, 'loopOriginBeat') &&
                    (action.payload.loopOriginBeat === null || isFiniteBeat(action.payload.loopOriginBeat)))) &&
            isFiniteBeat(previousOffset + startDelta + inverseCapture.beatDelta)
        );
    }
    return false;
}

function isCompletePair(pair: Pair): boolean {
    const { action, inverseAction: inverse, redoAction: redo } = pair;
    const inverseCapture = inverse.payload.midiRowCoordinates;
    const redoCapture = redo.payload.midiRowCoordinates;
    const originalCapture = action.payload.midiRowCoordinates;
    if (
        action.type !== inverse.type ||
        action.type !== redo.type ||
        action.payload.clipId !== inverse.payload.clipId ||
        action.payload.clipId !== redo.payload.clipId ||
        action.payload.clipId.length === 0 ||
        !isMidiRowCoordinateCapture(inverseCapture) ||
        !isMidiRowCoordinateCapture(redoCapture) ||
        inverseCapture.beatDelta !== -redoCapture.beatDelta
    ) {
        return false;
    }
    if (
        hasCapture(action) &&
        (!isMidiRowCoordinateCapture(originalCapture) || originalCapture.beatDelta !== redoCapture.beatDelta)
    ) {
        return false;
    }
    const { midiRowCoordinates: _redoCapture, ...redoRequest } = redo.payload;
    const { midiRowCoordinates: _actionCapture, ...originalRequest } = action.payload;
    if (!valuesEqual(originalRequest, redoRequest)) {
        return false;
    }
    if (action.type === 'slipClipContent') {
        return isSlipPairCoherent(pair, inverseCapture, originalCapture);
    }
    return isTrimPairCoherent(pair, inverseCapture);
}

/**
 * Each handler owns its pairs; hydration rebinds separate captures after validation.
 * Only this counteraction's own capture restores a row exactly. A row absent from
 * it receives semantic translation, even when another history entry captured it.
 */
export function createMidiRowCoordinateReplay(actionType: RowAction['type']) {
    const pairs = new WeakMap<RowAction, Pair>();
    const pending = new WeakMap<RowAction, Pair>();
    function bind(pair: Pair): void {
        pairs.set(pair.inverseAction, pair);
        pairs.set(pair.redoAction, pair);
    }
    return {
        describe: (action: RowAction, inverseAction: RowAction, redoAction: RowAction) => {
            const pair = { action, inverseAction, redoAction };
            pending.set(action, pair);
            // Replay's describe is discarded by skipUndo. Never bind action
            // itself here: it must keep its actual history counterpart. An
            // unexecuted description has no capture and retains the existing
            // arithmetic compensation route if execution throws partway through.
            return { inverseAction, redoAction };
        },
        canExecute: (action: RowAction): boolean => {
            const pair = pairs.get(action);
            return pair ? isCompletePair(pair) : !hasCapture(action);
        },
        recordApplied: (action: RowAction, capture: Capture): void => {
            const description = pending.get(action);
            if (description) {
                description.inverseAction.payload.midiRowCoordinates = capture;
                description.redoAction.payload.midiRowCoordinates = reverseCapture(capture);
                if (description.inverseAction.type === 'slipClipContent') {
                    description.inverseAction.payload.rowLiftBeats = capture.beatDelta === 0 ? 0 : -capture.beatDelta;
                }
                bind(description);
                pending.delete(action);
            }
            const pair = pairs.get(action);
            if (pair) {
                const counterpart = pair.inverseAction === action ? pair.redoAction : pair.inverseAction;
                counterpart.payload.midiRowCoordinates = capture;
            }
        },
        prepareAbort: (action: RowAction) => {
            const pair = pairs.get(action);
            const inverseCapture = pair?.inverseAction.payload.midiRowCoordinates;
            const redoCapture = pair?.redoAction.payload.midiRowCoordinates;
            return () => {
                if (!pair) {
                    return;
                }
                if (inverseCapture === undefined) {
                    delete pair.inverseAction.payload.midiRowCoordinates;
                } else {
                    pair.inverseAction.payload.midiRowCoordinates = inverseCapture;
                }
                if (redoCapture === undefined) {
                    delete pair.redoAction.payload.midiRowCoordinates;
                } else {
                    pair.redoAction.payload.midiRowCoordinates = redoCapture;
                }
                bind(pair);
            };
        },
        validateSessionEntry: (entry: HandlerSessionActionEntry): boolean => {
            if (!isRowAction(entry.action) || entry.action.type !== actionType) {
                return false;
            }
            if (!isRowAction(entry.inverseAction)) {
                return (
                    !hasCapture(entry.action) &&
                    (entry.redoAction === undefined || !isRowAction(entry.redoAction) || !hasCapture(entry.redoAction))
                );
            }
            const carriesCapture =
                hasCapture(entry.action) ||
                hasCapture(entry.inverseAction) ||
                (isRowAction(entry.redoAction) && hasCapture(entry.redoAction));
            // Existing saved entries retain their current admission policy.
            if (!carriesCapture) {
                return true;
            }
            if (!isRowAction(entry.redoAction)) {
                return false;
            }
            const pair = { action: entry.action, inverseAction: entry.inverseAction, redoAction: entry.redoAction };
            if (!isCompletePair(pair)) {
                return false;
            }
            bind(pair);
            return true;
        },
    };
}
