import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerExecutionResult } from '#/utils/handlerContract';

import { setTempo } from '../../useCases/setTempo';
import { getTempoWriteTarget } from '../../useCases/transportQueries/getTempoWriteTarget';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;

/**
 * Build the action that restores, or re-applies, a tempo write.
 *
 * A bare `setTempo` resolves its destination from the live playhead, so it is
 * position-dependent: replaying one as an inverse re-resolves it against
 * wherever the playhead has moved to since, and rewrites a different tempo
 * event. (Playhead at 0, set 100, seek to a later change, undo — the undo used
 * to write the *later* event, leaving the first one edited and the second one
 * clobbered.) Both the inverse and the redo therefore name the change the
 * original write landed on.
 */
function buildTargetedAction(bpm: number, tempoChangeId: string | null): SetTempoAction {
    if (tempoChangeId === null) {
        return { type: 'setTempo', payload: { bpm } };
    }
    return { type: 'setTempo', payload: { bpm, tempoChangeId } };
}

export const handleSetTempo = createHandler<'setTempo'>({
    execute: (alpha): HandlerExecutionResult | void => {
        const result = setTempo({ bpm: alpha.payload.bpm, tempoChangeId: alpha.payload.tempoChangeId });
        if (result.status === 'no-write') {
            // Nothing landed — a `linear` ramp segment carries no single event's
            // tempo, and a named change may have been deleted since. Reporting it
            // aborts the transaction and keeps a nothing-happened entry out of
            // the undo stack.
            return { status: 'no-write' };
        }
        return undefined;
    },
    // Compare against the governing tempo, not `transport.tempo`: with a tempo
    // map the base tempo is inert, so comparing against it would call a real
    // edit a no-op (and treat a real no-op as an edit).
    isNoop: (action) => {
        const target = getTempoWriteTarget({ tempoChangeId: action.payload.tempoChangeId });
        return target?.tempo === action.payload.bpm;
    },
    describe: (alpha) => {
        const label = `Set tempo to ${alpha.payload.bpm} BPM`;

        const target = getTempoWriteTarget({ tempoChangeId: alpha.payload.tempoChangeId });
        if (!target || !target.writable) {
            // `execute` reports `no-write` for exactly these cases, so no entry
            // reaches the stack. A null inverse must never be paired with a write
            // that lands: `undo` treats null-inverse entries as inert, drops them
            // and keeps scanning, so the next Ctrl+Z would undo an unrelated
            // earlier action while the destroyed tempo stayed destroyed.
            return { label, inverseAction: null };
        }

        return {
            label,
            inverseAction: buildTargetedAction(target.tempo, target.tempoChangeId),
            redoAction: buildTargetedAction(alpha.payload.bpm, target.tempoChangeId),
        };
    },
    undoable: true,
});
