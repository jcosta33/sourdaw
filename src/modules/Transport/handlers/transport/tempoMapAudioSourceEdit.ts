import {
    applyTempoAudioSources,
    canApplyTempoAudioSources,
    prepareTempoAudioSources,
} from '#/modules/Arrangement/useCases';
import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import {
    type AppAction,
    type HandlerCommitValidation,
    type HandlerSessionActionEntry,
    type HandlerValidationContext,
} from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { isTempoAudioSourcePromotion } from '#/utils/tempoAudioSourcePromotion';
import {
    decodeTempoMapRowPlan,
    isTempoMapEdit,
    observeTempoMapRowPlan,
    readTempoMapRows,
    type TempoMapRowPlan,
} from '#/utils/tempoMapRowPlan';

import {
    BEAT_EPSILON,
    MAX_TEMPO_MAP_TEMPO,
    MIN_TEMPO_MAP_TEMPO,
    createTempoChange,
    getTempoAtBeat,
    samplesToBeat,
    secondsBetweenBeats,
} from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { runWithTempoMapRowWriteIntent, runWithTempoSourcePreservation } from '../../stores/tempoWriteIntent';
import { transportStore } from '../../stores/transportStore';
import { applyTempoMapRowPlan } from '../../useCases/tempoMap/applyTempoMapRowPlan';
import { planTempoMapEdit } from '../../useCases/tempoMap/planTempoMapEdit';
import { timelineMapTimeStateCodec } from '../../useCases/tempoMap/timelineMapTimeStateCodec';

type EditAction = Extract<AppAction, { type: 'editTempoMap' }>;
type RestoreAction = Extract<AppAction, { type: 'restoreTempoMapEdit' }>;
type CapturedEditPayload = EditAction['payload'] & {
    rowPlan: TempoMapRowPlan;
    audioSourcePromotion: RestoreAction['payload']['audioSourcePromotion'];
};
type Context = Pick<HandlerValidationContext, 'actions' | 'actionIndex'>;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function admittedPlan(value: unknown): TempoMapRowPlan | null {
    const plan = decodeTempoMapRowPlan(value);
    if (
        !plan ||
        ![plan.before, plan.after].every((changes) =>
            timelineMapTimeStateCodec.encodeState({
                tempoState: { changes: [...changes] },
                timeSignatureState: { changes: [] },
            })
        )
    ) {
        return null;
    }
    return plan;
}

function planMatchesEdit(edit: EditAction['payload']['edit'], plan: TempoMapRowPlan): boolean {
    if (edit.type !== plan.operation) {
        return false;
    }
    const before = plan.before[0];
    const after = plan.after[0];
    const bounded = (tempo: number) => Math.max(MIN_TEMPO_MAP_TEMPO, Math.min(MAX_TEMPO_MAP_TEMPO, tempo));
    if (edit.type === 'replace') {
        return (
            edit.changes.length === plan.after.length &&
            edit.changes.every((row, index) => {
                const captured = plan.after[index];
                return (
                    captured && valuesEqual(row, { beat: captured.beat, tempo: captured.tempo, curve: captured.curve })
                );
            })
        );
    }
    if (edit.type === 'remove') {
        return before?.id === edit.id;
    }
    if (edit.type === 'update') {
        return before?.id === edit.id && after?.tempo === bounded(edit.tempo);
    }
    if (
        !after ||
        !plan.collision ||
        !Object.is(plan.collision.beat, edit.beat) ||
        after.curve !== (edit.curve ?? 'instant')
    ) {
        return false;
    }
    if (plan.collision.targetId === null) {
        return Object.is(after.beat, edit.beat) && after.tempo === bounded(edit.tempo);
    }
    return before !== undefined && Math.abs(before.beat - edit.beat) <= BEAT_EPSILON && after.tempo === edit.tempo;
}

export function isTempoMapEditCapture(value: unknown): value is CapturedEditPayload {
    if (
        !isRecord(value) ||
        !exactKeys(value, ['edit', 'rowPlan', 'audioSourcePromotion']) ||
        !isTempoMapEdit(value.edit) ||
        !isTempoAudioSourcePromotion(value.audioSourcePromotion)
    ) {
        return false;
    }
    const plan = admittedPlan(value.rowPlan);
    return plan !== null && planMatchesEdit(value.edit, plan);
}

export function isTempoMapRestore(value: unknown): value is RestoreAction['payload'] {
    return (
        isRecord(value) &&
        exactKeys(value, ['rowPlan', 'rowDirection', 'sourceDirection', 'audioSourcePromotion']) &&
        admittedPlan(value.rowPlan) !== null &&
        isTempoAudioSourcePromotion(value.audioSourcePromotion) &&
        ((value.rowDirection === 'apply' && value.sourceDirection === 'promote') ||
            (value.rowDirection === 'restore' && value.sourceDirection === 'restore'))
    );
}

function sourceInput(payload: RestoreAction['payload']) {
    const plan = admittedPlan(payload.rowPlan);
    const state = tempoMapStore.value;
    const transport = transportStore.value;
    if (!plan || !state || !transport) {
        return null;
    }
    const next = applyTempoMapRowPlan({ changes: state.changes, plan, direction: payload.rowDirection });
    if (!next) {
        return null;
    }
    const original = structuredClone(payload.sourceDirection === 'promote' ? state.changes : next);
    const tempo = transport.tempo;
    return {
        next,
        source: {
            promotion: payload.audioSourcePromotion,
            direction: payload.sourceDirection,
            timeline: {
                tempoAtBeat: (beat: number) => getTempoAtBeat(original, beat, tempo),
                secondsAtBeat: (beat: number) => secondsBetweenBeats(original, 0, beat, tempo),
                beatAtSeconds: (seconds: number) => samplesToBeat(original, seconds, tempo, 1),
            },
            clock: { transport: { tempo }, tempoMap: { changes: structuredClone(state.changes) } },
            rowClock: {
                witness: { plan, direction: payload.rowDirection },
                after: { transport: { tempo }, tempoMap: { changes: next } },
            },
        },
    };
}

export function materializeTempoMapEdit(action: EditAction): void {
    delete action.payload.rowPlan;
    delete action.payload.audioSourcePromotion;
    if (!isTempoMapEdit(action.payload.edit)) {
        return;
    }
    // New coordinates use the map adapter's existing zero representation.
    // Captured current rows remain exact FROM witnesses, including their sign.
    const edit = action.payload.edit;
    if (edit.type === 'add') {
        action.payload.edit = { ...edit, beat: edit.beat === 0 ? 0 : edit.beat };
    } else if (edit.type === 'replace') {
        action.payload.edit = {
            ...edit,
            changes: edit.changes.map((row) => ({ ...row, beat: row.beat === 0 ? 0 : row.beat })),
        };
    }
    const result = planTempoMapEdit({
        changes: tempoMapStore.value?.changes ?? null,
        edit: action.payload.edit,
        createRow: createTempoChange,
    });
    const transport = transportStore.value;
    if (result.status !== 'ready' || !transport) {
        return;
    }
    const changes = structuredClone(tempoMapStore.value?.changes ?? []);
    const tempo = transport.tempo;
    const promotion = prepareTempoAudioSources({
        timeline: {
            tempoAtBeat: (beat) => getTempoAtBeat(changes, beat, tempo),
            secondsAtBeat: (beat) => secondsBetweenBeats(changes, 0, beat, tempo),
            beatAtSeconds: (seconds) => samplesToBeat(changes, seconds, tempo, 1),
        },
    });
    if (!promotion) {
        return;
    }
    action.payload.rowPlan = result.plan;
    action.payload.audioSourcePromotion = promotion;
}

export function isTempoMapEditNoop(action: EditAction): boolean {
    if (action.payload.rowPlan !== undefined || !isTempoMapEdit(action.payload.edit)) {
        return false;
    }
    return (
        planTempoMapEdit({ changes: tempoMapStore.value?.changes ?? null, edit: action.payload.edit }).status ===
        'no-op'
    );
}

export function capturedTempoMapReplay(action: EditAction, rowDirection: 'apply' | 'restore'): RestoreAction | null {
    if (!isTempoMapEditCapture(action.payload)) {
        return null;
    }
    return {
        type: 'restoreTempoMapEdit',
        payload: {
            rowPlan: structuredClone(action.payload.rowPlan),
            rowDirection,
            sourceDirection: rowDirection === 'apply' ? 'promote' : 'restore',
            audioSourcePromotion: structuredClone(action.payload.audioSourcePromotion),
        },
    };
}

export function tempoMapSourcesApply(payload: RestoreAction['payload']): boolean {
    const prepared = sourceInput(payload);
    return prepared !== null && canApplyTempoAudioSources(prepared.source);
}

function rowCommitGuard(payload: RestoreAction['payload']): HandlerCommitValidation | null {
    const plan = admittedPlan(payload.rowPlan);
    if (!plan) {
        return null;
    }
    const witness = { plan, direction: payload.rowDirection };
    const beforeCommit = () => {
        const document = getCrdtDoc('root');
        const changes = document ? readTempoMapRows(document) : null;
        return changes && applyTempoMapRowPlan({ changes, plan, direction: payload.rowDirection })
            ? null
            : 'Tempo-map row owner changed before commit';
    };
    if (beforeCommit()) {
        return null;
    }
    return {
        documentId: 'root',
        beforeCommit,
        validateDocument: (document) =>
            observeTempoMapRowPlan(document, witness) === 'to'
                ? null
                : 'Tempo-map edit did not publish its captured rows',
        release: () => undefined,
    };
}

export function writeTempoMapEdit(payload: RestoreAction['payload'], context?: Context) {
    const prepared = sourceInput(payload);
    const rowGuard = rowCommitGuard(payload);
    if (!prepared || !rowGuard) {
        rowGuard?.release();
        return { status: 'conflict' as const };
    }
    let source: ReturnType<typeof applyTempoAudioSources>;
    try {
        source = applyTempoAudioSources({ ...prepared.source, context });
    } catch (error) {
        rowGuard.release();
        throw error;
    }
    if (source.status === 'conflict') {
        rowGuard.release();
        return { status: 'conflict' as const };
    }
    const commitValidation: HandlerCommitValidation = {
        documentId: 'root',
        beforeCommit: () => rowGuard.beforeCommit() ?? source.commitValidation.beforeCommit(),
        validateDocument: (document) =>
            rowGuard.validateDocument(document) ?? source.commitValidation.validateDocument(document),
        release: () => {
            rowGuard.release();
            source.commitValidation.release();
        },
    };
    try {
        runWithTempoSourcePreservation(source.sourcePreservation, () =>
            runWithTempoMapRowWriteIntent(prepared.source.rowClock.witness, () =>
                tempoMapStore.set({ changes: prepared.next })
            )
        );
        return { status: 'written' as const, commitValidation };
    } catch (error) {
        commitValidation.release();
        throw error;
    }
}

export function isTempoMapEditSessionEntry(entry: HandlerSessionActionEntry): boolean {
    return (
        entry.action.type === 'editTempoMap' &&
        isTempoMapEditCapture(entry.action.payload) &&
        valuesEqual(entry.inverseAction, capturedTempoMapReplay(entry.action, 'restore')) &&
        valuesEqual(entry.redoAction, capturedTempoMapReplay(entry.action, 'apply'))
    );
}
