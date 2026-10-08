import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerExecutionResult, type TempoAudioSourceTransition } from '#/utils/handlerContract';

import { getTempoAtBeat } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';
import { markTempoProjectWrite } from '../../useCases/markTempoProjectWrite';
import { setTempo } from '../../useCases/setTempo';
import { tempoSourceDependencies } from '../../useCases/tempoSourceDependencies';
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
function buildTargetedAction(
    bpm: number,
    tempoChangeId: string | null,
    expectedBpm: number,
    sourceTransition?: TempoAudioSourceTransition
): SetTempoAction {
    const payload = { bpm, expectedBpm, tempoChangeId };
    if (sourceTransition) {
        return { type: 'setTempo', payload: { ...payload, sourceTransition } };
    }
    return {
        type: 'setTempo',
        payload,
    };
}

function nextTempoAtBeat(action: SetTempoAction, tempoChangeId: string | null): (beat: number) => number {
    const changes = tempoMapStore.value?.changes ?? [];
    const baseTempo = transportStore.value?.tempo ?? action.payload.bpm;
    if (tempoChangeId === null) {
        return (beat) => getTempoAtBeat(changes, beat, action.payload.bpm);
    }
    const nextChanges = changes.map((change) =>
        change.id === tempoChangeId ? { ...change, tempo: action.payload.bpm } : change
    );
    return (beat) => getTempoAtBeat(nextChanges, beat, baseTempo);
}

function prepareSourceChange(action: SetTempoAction, tempoChangeId: string | null) {
    if (!tempoSourceDependencies.available()) {
        return null;
    }
    if (action.payload.expectedBpm !== undefined && action.payload.sourceTransition === undefined) {
        // Entries saved before source captures existed retain their tempo-only replay shape.
        return null;
    }
    return tempoSourceDependencies.prepare({
        nextTempoAtBeat: nextTempoAtBeat(action, tempoChangeId),
        replay: action.payload.sourceTransition,
    });
}

export const handleSetTempo = createHandler<'setTempo'>({
    previewExecution: 'isolated-project',
    validateSessionEntry: (entry) => {
        if (
            entry.action.type !== 'setTempo' ||
            entry.inverseAction?.type !== 'setTempo' ||
            entry.redoAction?.type !== 'setTempo'
        ) {
            return false;
        }
        const forward = entry.action.payload;
        const inverse = entry.inverseAction.payload;
        const redo = entry.redoAction.payload;
        if (
            forward.sourceTransition !== undefined ||
            inverse.expectedBpm !== forward.bpm ||
            redo.bpm !== forward.bpm ||
            redo.expectedBpm !== inverse.bpm ||
            inverse.tempoChangeId !== redo.tempoChangeId
        ) {
            return false;
        }
        if (inverse.sourceTransition === undefined || redo.sourceTransition === undefined) {
            return inverse.sourceTransition === undefined && redo.sourceTransition === undefined;
        }
        return (
            tempoSourceDependencies.isTransition(inverse.sourceTransition) &&
            tempoSourceDependencies.isTransition(redo.sourceTransition) &&
            inverse.sourceTransition.direction === 'restore' &&
            redo.sourceTransition.direction === 'apply' &&
            JSON.stringify({ ...inverse.sourceTransition, direction: 'apply' }) ===
                JSON.stringify(redo.sourceTransition)
        );
    },
    canReapplyAfterDivergence: (action) => action.payload.expectedBpm !== undefined,
    validate: (action) => {
        const target = getTempoWriteTarget({ tempoChangeId: action.payload.tempoChangeId });
        const targetMatches =
            (action.payload.sourceTransition === undefined || action.payload.expectedBpm !== undefined) &&
            target?.writable === true &&
            (action.payload.expectedBpm === undefined || target.tempo === action.payload.expectedBpm);
        if (!targetMatches || !target) {
            return false;
        }
        return (
            !tempoSourceDependencies.available() ||
            (action.payload.expectedBpm !== undefined && action.payload.sourceTransition === undefined) ||
            prepareSourceChange(action, target.tempoChangeId) !== null
        );
    },
    execute: (alpha): HandlerExecutionResult | void => {
        if (alpha.payload.expectedBpm !== undefined) {
            const target = getTempoWriteTarget({ tempoChangeId: alpha.payload.tempoChangeId });
            if (target?.writable !== true || target.tempo !== alpha.payload.expectedBpm) {
                return { status: 'conflict' };
            }
        }
        const target = getTempoWriteTarget({ tempoChangeId: alpha.payload.tempoChangeId });
        if (!target) {
            return { status: 'no-write' };
        }
        if (!target.writable) {
            setTempo({ bpm: alpha.payload.bpm, tempoChangeId: alpha.payload.tempoChangeId });
            return { status: 'no-write' };
        }
        const sourceChange = prepareSourceChange(alpha, target.tempoChangeId);
        if (
            tempoSourceDependencies.available() &&
            (alpha.payload.expectedBpm === undefined || alpha.payload.sourceTransition !== undefined) &&
            sourceChange === null
        ) {
            return { status: 'conflict' };
        }
        const result = setTempo({ bpm: alpha.payload.bpm, tempoChangeId: alpha.payload.tempoChangeId });
        if (result.status === 'no-write') {
            // There was nothing to write to — no transport state, or a named
            // change deleted since. Reporting it aborts the transaction and keeps
            // a nothing-happened entry out of the undo stack. A *refused* write
            // inside a ramp throws out of `setTempo` instead, so it reaches the
            // caller rather than vanishing into the same silent abort.
            return { status: 'no-write' };
        }
        if (sourceChange && !sourceChange.apply()) {
            return { status: 'conflict' };
        }
        return {
            status: 'written',
            afterCommit: markTempoProjectWrite,
            afterAmbiguousCommit: markTempoProjectWrite,
        };
    },
    // Compare against the governing tempo, not `transport.tempo`: with a tempo
    // map the base tempo is inert, so comparing against it would call a real
    // edit a no-op (and treat a real no-op as an edit).
    isNoop: (action) => {
        const target = getTempoWriteTarget({ tempoChangeId: action.payload.tempoChangeId });
        if (target && !target.writable) {
            // The interpolated tempo inside a ramp is a tempo no event holds, so
            // matching it is not "already done" — it is still a refusal. Calling
            // it a no-op returned from `executeAppAction` before `execute` ever
            // ran, hiding the refusal exactly as the old `no-write` did.
            return false;
        }
        return (
            target?.tempo === action.payload.bpm &&
            (action.payload.expectedBpm === undefined || target.tempo === action.payload.expectedBpm)
        );
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

        let source: TempoAudioSourceTransition | undefined;
        if (tempoSourceDependencies.available()) {
            source = tempoSourceDependencies.prepare({
                nextTempoAtBeat: nextTempoAtBeat(alpha, target.tempoChangeId),
            })?.transition;
        }

        return {
            label,
            inverseAction: buildTargetedAction(
                target.tempo,
                target.tempoChangeId,
                alpha.payload.bpm,
                source ? { ...source, direction: 'restore' } : undefined
            ),
            redoAction: buildTargetedAction(
                alpha.payload.bpm,
                target.tempoChangeId,
                target.tempo,
                source ? { ...source, direction: 'apply' } : undefined
            ),
        };
    },
    undoable: true,
});
