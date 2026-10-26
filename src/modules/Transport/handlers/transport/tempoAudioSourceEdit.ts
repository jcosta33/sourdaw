import {
    applyTempoAudioSources,
    canApplyTempoAudioSources,
    prepareTempoAudioSources,
} from '#/modules/Arrangement/useCases';
import { type AppAction, type HandlerSessionActionEntry, type HandlerValidationContext } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import {
    isTempoAudioSourcePromotion,
    projectTempoSourceClock,
    type TempoSourceClock,
    type TempoScalarTransition,
    type TempoSourceClockPath,
} from '#/utils/tempoAudioSourcePromotion';

import { getTempoAtBeat, samplesToBeat, secondsBetweenBeats } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';
import { getTempoWriteTarget } from '../../useCases/transportQueries/getTempoWriteTarget';
import { setTempo } from '../../useCases/setTempo';
import { runWithTempoSourcePreservation } from '../../stores/tempoWriteIntent';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;
type RestoreAction = Extract<AppAction, { type: 'restoreTempoEdit' }>;
type PrefixContext = Pick<HandlerValidationContext, 'actions' | 'actionIndex'>;

function prefixActions(context?: PrefixContext): readonly AppAction[] {
    return context?.actions.slice(0, context.actionIndex) ?? [];
}

function prefixClock(actions: readonly AppAction[]): TempoSourceClock | null {
    const transport = transportStore.value;
    if (!transport) {
        return null;
    }
    let clock: TempoSourceClock = structuredClone({
        tempo: transport.tempo,
        changes: tempoMapStore.value?.changes ?? [],
    });
    for (const action of actions) {
        if (action.type !== 'setTempo' && action.type !== 'restoreTempoEdit') {
            continue;
        }
        const { tempoChangeId, expectedBpm, bpm } = action.payload;
        if (tempoChangeId === undefined || expectedBpm === undefined) {
            return null;
        }
        const next = projectTempoSourceClock(clock, [{ tempoChangeId, expectedBpm, bpm }]);
        if (!next) {
            return null;
        }
        clock = next;
    }
    return clock;
}

export function tempoPrefixTarget(action: SetTempoAction | RestoreAction, context?: PrefixContext) {
    const clock = prefixClock(prefixActions(context));
    return clock ? getTempoWriteTarget({ tempoChangeId: action.payload.tempoChangeId, clock }) : null;
}

function clockBeforeEdit(tempoChangeId: string | null, originalBpm: number, priorActions: readonly AppAction[] = []) {
    const transport = transportStore.value;
    if (!transport) {
        return null;
    }
    const tempoMap = tempoMapStore.value;
    const prefix = prefixClock(priorActions);
    if (!prefix) {
        return null;
    }
    const changes = prefix.changes;
    if (tempoChangeId !== null && !changes.some((change) => change.id === tempoChangeId)) {
        return null;
    }
    const oldChanges = changes.map((change) =>
        change.id === tempoChangeId ? { ...change, tempo: originalBpm } : change
    );
    const oldTempo = tempoChangeId === null ? originalBpm : prefix.tempo;
    return {
        clock: { transport: { ...transport, tempo: prefix.tempo }, tempoMap: { ...tempoMap, changes } },
        timeline: {
            tempoAtBeat: (beat: number) => getTempoAtBeat(oldChanges, beat, oldTempo),
            secondsAtBeat: (beat: number) => secondsBetweenBeats(oldChanges, 0, beat, oldTempo),
            beatAtSeconds: (seconds: number) => samplesToBeat(oldChanges, seconds, oldTempo, 1),
        },
    };
}

export function materializeTempoAudioSources(action: SetTempoAction, context?: PrefixContext): void {
    // Caller JSON can carry snapshots, but only the actual producer grants this capture.
    delete action.payload.audioSourcePromotion;
    const priorActions = prefixActions(context);
    const target = tempoPrefixTarget(action, context);
    if (
        !target?.writable ||
        (action.payload.expectedBpm !== undefined && action.payload.expectedBpm !== target.tempo)
    ) {
        return;
    }
    const source = clockBeforeEdit(target.tempoChangeId, target.tempo, priorActions);
    let promotion: ReturnType<typeof prepareTempoAudioSources> = null;
    if (source) {
        promotion = prepareTempoAudioSources({ timeline: source.timeline, priorActions });
    }
    if (!promotion) {
        return;
    }
    action.payload.tempoChangeId = target.tempoChangeId;
    action.payload.expectedBpm = target.tempo;
    action.payload.audioSourcePromotion = promotion;
}

function sourceInput(payload: RestoreAction['payload'], priorActions: readonly AppAction[] = []) {
    const originalBpm = payload.sourceDirection === 'promote' ? payload.expectedBpm : payload.bpm;
    const source = clockBeforeEdit(payload.tempoChangeId, originalBpm, priorActions);
    if (!source) {
        return null;
    }
    return {
        ...source,
        promotion: payload.audioSourcePromotion,
        direction: payload.sourceDirection,
        target: { tempoChangeId: payload.tempoChangeId, expectedBpm: payload.expectedBpm, bpm: payload.bpm },
    };
}

export function tempoAudioSourcesApply(payload: RestoreAction['payload'], context?: PrefixContext): boolean {
    const priorActions = prefixActions(context);
    const input = sourceInput(payload, priorActions);
    return input !== null && canApplyTempoAudioSources(input, priorActions);
}

function capturedClockPath(payload: RestoreAction['payload'], context?: PrefixContext): TempoSourceClockPath | null {
    const actions = context?.actions;
    if (!actions) {
        return null;
    }
    const current = actions[context.actionIndex];
    if (
        (current?.type !== 'setTempo' && current?.type !== 'restoreTempoEdit') ||
        current.payload.tempoChangeId !== payload.tempoChangeId ||
        current.payload.expectedBpm !== payload.expectedBpm ||
        current.payload.bpm !== payload.bpm
    ) {
        return null;
    }
    const transitions: TempoScalarTransition[] = [];
    const prior: TempoScalarTransition[] = [];
    for (const [index, action] of actions.entries()) {
        if (action.type !== 'setTempo' && action.type !== 'restoreTempoEdit') {
            continue;
        }
        const { tempoChangeId, expectedBpm, bpm } = action.payload;
        if (tempoChangeId === undefined || expectedBpm === undefined) {
            return null;
        }
        const transition = { tempoChangeId, expectedBpm, bpm };
        transitions.push(transition);
        if (index < context.actionIndex) {
            prior.push(transition);
        }
    }
    const actual = prefixClock([]);
    if (!actual) {
        return null;
    }
    const reversed = [...prior].reverse().map((row) => ({ ...row, expectedBpm: row.bpm, bpm: row.expectedBpm }));
    const initial = projectTempoSourceClock(actual, reversed);
    if (!initial || !projectTempoSourceClock(initial, transitions)) {
        return null;
    }
    const before: TempoSourceClockPath['before'][number][] = [];
    for (const id of new Set(transitions.map((row) => row.tempoChangeId))) {
        const tempo = id === null ? actual.tempo : actual.changes.find((row) => row.id === id)?.tempo;
        if (tempo === undefined) {
            return null;
        }
        before.push({ tempoChangeId: id, tempo });
    }
    return { transitions, before };
}

export function writeTempoEdit(payload: RestoreAction['payload'], context?: PrefixContext) {
    const input = sourceInput(payload);
    if (!input) {
        return { status: 'conflict' as const };
    }
    const clockPath = capturedClockPath(payload, context);
    if (context && !clockPath) {
        return { status: 'conflict' as const };
    }
    let source: ReturnType<typeof applyTempoAudioSources>;
    if (clockPath) {
        source = applyTempoAudioSources({ ...input, context, clockPath });
    } else {
        source = applyTempoAudioSources({ ...input, context });
    }
    if (source.status === 'conflict') {
        return { status: 'conflict' as const };
    }
    try {
        const result = runWithTempoSourcePreservation(source.sourcePreservation, () =>
            setTempo({ bpm: payload.bpm, tempoChangeId: payload.tempoChangeId })
        );
        if (result.status !== 'written') {
            source.commitValidation.release();
            return { status: 'conflict' as const };
        }
        return { status: 'written' as const, commitValidation: source.commitValidation };
    } catch (error) {
        source.commitValidation.release();
        throw error;
    }
}

export function capturedTempoReplay(action: SetTempoAction, direction: 'promote' | 'restore'): RestoreAction | null {
    const { bpm, expectedBpm, tempoChangeId, audioSourcePromotion } = action.payload;
    if (expectedBpm === undefined || tempoChangeId === undefined || tempoChangeId === '' || !audioSourcePromotion) {
        return null;
    }
    return {
        type: 'restoreTempoEdit',
        payload: {
            bpm: direction === 'promote' ? bpm : expectedBpm,
            expectedBpm: direction === 'promote' ? expectedBpm : bpm,
            tempoChangeId,
            sourceDirection: direction,
            audioSourcePromotion: structuredClone(audioSourcePromotion),
        },
    };
}

export function isRestoreTempoEditPayload(value: unknown): value is RestoreAction['payload'] {
    return (
        isRecord(value) &&
        Object.keys(value).length === 5 &&
        Object.keys(value).every((key) =>
            ['bpm', 'expectedBpm', 'tempoChangeId', 'sourceDirection', 'audioSourcePromotion'].includes(key)
        ) &&
        typeof value.bpm === 'number' &&
        Number.isFinite(value.bpm) &&
        typeof value.expectedBpm === 'number' &&
        Number.isFinite(value.expectedBpm) &&
        (value.tempoChangeId === null || (typeof value.tempoChangeId === 'string' && value.tempoChangeId.length > 0)) &&
        (value.sourceDirection === 'promote' || value.sourceDirection === 'restore') &&
        isTempoAudioSourcePromotion(value.audioSourcePromotion)
    );
}

export function isTempoEditSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (entry.action.type !== 'setTempo') {
        return false;
    }
    if (!entry.action.payload.audioSourcePromotion) {
        // Earlier histories only owned a pinned scalar. They keep that replay contract.
        return entry.inverseAction?.type === 'setTempo' && (!entry.redoAction || entry.redoAction.type === 'setTempo');
    }
    const inverse = capturedTempoReplay(entry.action, 'restore');
    const redo = capturedTempoReplay(entry.action, 'promote');
    return (
        inverse !== null &&
        redo !== null &&
        isRestoreTempoEditPayload(inverse.payload) &&
        valuesEqual(entry.inverseAction, inverse) &&
        valuesEqual(entry.redoAction, redo)
    );
}
