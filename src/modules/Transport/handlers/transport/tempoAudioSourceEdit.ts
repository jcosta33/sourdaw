import {
    applyTempoAudioSources,
    canApplyTempoAudioSources,
    prepareTempoAudioSources,
} from '#/modules/Arrangement/useCases';
import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { isTempoAudioSourcePromotion } from '#/utils/tempoAudioSourcePromotion';

import { getTempoAtBeat, samplesToBeat, secondsBetweenBeats } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';
import { getTempoWriteTarget } from '../../useCases/transportQueries/getTempoWriteTarget';
import { setTempo } from '../../useCases/setTempo';
import { runWithTempoSourcePreservation } from '../../stores/tempoWriteIntent';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;
type RestoreAction = Extract<AppAction, { type: 'restoreTempoEdit' }>;

function clockBeforeEdit(tempoChangeId: string | null, originalBpm: number) {
    const transport = transportStore.value;
    if (!transport) {
        return null;
    }
    const tempoMap = tempoMapStore.value;
    const changes = structuredClone(tempoMap?.changes ?? []);
    if (tempoChangeId !== null && !changes.some((change) => change.id === tempoChangeId)) {
        return null;
    }
    const oldChanges = changes.map((change) =>
        change.id === tempoChangeId ? { ...change, tempo: originalBpm } : change
    );
    const oldTempo = tempoChangeId === null ? originalBpm : transport.tempo;
    return {
        clock: { transport, tempoMap },
        timeline: {
            tempoAtBeat: (beat: number) => getTempoAtBeat(oldChanges, beat, oldTempo),
            secondsAtBeat: (beat: number) => secondsBetweenBeats(oldChanges, 0, beat, oldTempo),
            beatAtSeconds: (seconds: number) => samplesToBeat(oldChanges, seconds, oldTempo, 1),
        },
    };
}

export function materializeTempoAudioSources(action: SetTempoAction): void {
    // Caller JSON can carry snapshots, but only the actual producer grants this capture.
    delete action.payload.audioSourcePromotion;
    const target = getTempoWriteTarget({ tempoChangeId: action.payload.tempoChangeId });
    if (
        !target?.writable ||
        (action.payload.expectedBpm !== undefined && action.payload.expectedBpm !== target.tempo)
    ) {
        return;
    }
    const source = clockBeforeEdit(target.tempoChangeId, target.tempo);
    let promotion: ReturnType<typeof prepareTempoAudioSources> = null;
    if (source) {
        promotion = prepareTempoAudioSources({ timeline: source.timeline });
    }
    if (!promotion) {
        return;
    }
    action.payload.tempoChangeId = target.tempoChangeId;
    action.payload.expectedBpm = target.tempo;
    action.payload.audioSourcePromotion = promotion;
}

function sourceInput(payload: RestoreAction['payload']) {
    const originalBpm = payload.sourceDirection === 'promote' ? payload.expectedBpm : payload.bpm;
    const source = clockBeforeEdit(payload.tempoChangeId, originalBpm);
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

export function tempoAudioSourcesApply(payload: RestoreAction['payload']): boolean {
    const input = sourceInput(payload);
    return input !== null && canApplyTempoAudioSources(input);
}

export function writeTempoEdit(payload: RestoreAction['payload']): 'written' | 'conflict' {
    const input = sourceInput(payload);
    if (!input) {
        return 'conflict';
    }
    if (applyTempoAudioSources(input) === 'conflict') {
        return 'conflict';
    }
    const result = runWithTempoSourcePreservation({ promotion: input.promotion, direction: input.direction }, () =>
        setTempo({ bpm: payload.bpm, tempoChangeId: payload.tempoChangeId })
    );
    return result.status === 'written' ? 'written' : 'conflict';
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
