import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { applySendAutomationRanges } from '../../useCases/automation/applySendAutomationRanges';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type AutomateSendRangesAction = Extract<AppAction, { type: 'automateSendRanges' }>;
type MaterializedPayload = AutomateSendRangesAction['payload'] & {
    busName: string;
    expectedTimeSignature: [number, number];
    ranges: NonNullable<AutomateSendRangesAction['payload']['ranges']>;
    expectedTracks: NonNullable<AutomateSendRangesAction['payload']['expectedTracks']>;
};

function getMaterializedPayload(action: AutomateSendRangesAction): MaterializedPayload | null {
    if (
        action.payload.busName === undefined ||
        action.payload.expectedTimeSignature === undefined ||
        action.payload.ranges === undefined ||
        action.payload.expectedTracks === undefined
    ) {
        return null;
    }
    return {
        ...action.payload,
        busName: action.payload.busName,
        expectedTimeSignature: action.payload.expectedTimeSignature,
        ranges: action.payload.ranges,
        expectedTracks: action.payload.expectedTracks,
    };
}

function getPlannedBus(payload: MaterializedPayload, priorActions: readonly AppAction[]) {
    let bus: { id: string; kind: string; name: string } | undefined = trackStore.value?.tracks.find(
        (track) => track.id === payload.busId
    );
    for (const action of priorActions) {
        if (action.type === 'createBus' && action.payload.busId === payload.busId) {
            bus = { id: payload.busId, kind: 'bus', name: action.payload.name };
        }
        if (
            (action.type === 'discardCreatedTrack' || action.type === 'removeTrack') &&
            action.payload.trackId === payload.busId
        ) {
            bus = undefined;
        }
    }
    return bus;
}

function getPlannedSend(trackId: string, busId: string, priorActions: readonly AppAction[]) {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    let send = track?.sends.find((candidate) => candidate.busId === busId);
    for (const action of priorActions) {
        if (action.type === 'addSend' && action.payload.trackId === trackId && action.payload.busId === busId) {
            send = {
                busId,
                level: action.payload.level,
                preFader: action.payload.preFader ?? false,
            };
        }
        if (action.type === 'setSend' && action.payload.trackId === trackId && action.payload.busId === busId && send) {
            send = { ...send, level: action.payload.level };
        }
        if (action.type === 'removeSend' && action.payload.trackId === trackId && action.payload.busId === busId) {
            send = undefined;
        }
    }
    return send;
}

function currentStateMatches(payload: MaterializedPayload, priorActions: readonly AppAction[] = []): boolean {
    const bus = getPlannedBus(payload, priorActions);
    const transport = transportStore.value;
    if (
        bus?.kind !== 'bus' ||
        bus.name !== payload.busName ||
        transport?.timeSignatureNumerator !== payload.expectedTimeSignature[0] ||
        transport.timeSignatureDenominator !== payload.expectedTimeSignature[1] ||
        payload.trackIds.length !== payload.expectedTracks.length ||
        payload.sectionIds.length !== payload.ranges.length
    ) {
        return false;
    }
    const sectionsById = new Map((markerStore.value?.sections ?? []).map((section) => [section.id, section]));
    if (
        !payload.ranges.every((range, index) => {
            const section = sectionsById.get(range.sectionId);
            return (
                payload.sectionIds[index] === range.sectionId &&
                section?.name === range.sectionName &&
                section.startBeat === range.startBeat &&
                section.endBeat === range.endBeat
            );
        })
    ) {
        return false;
    }
    const automation = getAutomationStoreState();
    if (!automation) {
        return false;
    }
    return payload.expectedTracks.every((expected, index) => {
        const track = trackStore.value?.tracks.find((candidate) => candidate.id === expected.trackId);
        const send = getPlannedSend(expected.trackId, payload.busId, priorActions);
        const laneId = `auto-send-${encodeURIComponent(expected.trackId)}-${encodeURIComponent(payload.busId)}`;
        return (
            payload.trackIds[index] === expected.trackId &&
            track?.name === expected.trackName &&
            track.frozen === expected.frozen &&
            track.automationMode === expected.automationMode &&
            send?.level === expected.sendLevel &&
            send.preFader === expected.sendPreFader &&
            !automation.lanes.some(
                (lane) =>
                    lane.id === laneId ||
                    (!lane.clipId && lane.trackId === expected.trackId && lane.parameterId === `send:${payload.busId}`)
            )
        );
    });
}

export const handleAutomateSendRanges = createHandler<'automateSendRanges'>({
    validate: (action, context) => {
        const payload = getMaterializedPayload(action);
        return payload !== null && currentStateMatches(payload, context.actions.slice(0, context.actionIndex));
    },
    execute: (action) => {
        const payload = getMaterializedPayload(action);
        if (!payload || !currentStateMatches(payload)) {
            return { status: 'conflict' };
        }
        const written = applySendAutomationRanges({
            busId: payload.busId,
            busName: payload.busName,
            expectedTracks: payload.expectedTracks,
            ranges: payload.ranges,
            targetLevelDb: payload.targetLevelDb,
        });
        return written ? { status: 'written' } : { status: 'conflict' };
    },
    describe: (action) => {
        const payload = getMaterializedPayload(action);
        const sectionNames = payload?.ranges.map((range) => range.sectionName).join(', ') ?? 'selected sections';
        const label = `Ramp ${String(action.payload.trackIds.length)} sends to ${String(action.payload.targetLevelDb)} dB over the final ${String(action.payload.tailBars)} bars of ${sectionNames}`;
        if (!payload) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: { type: 'removeSendAutomationRanges', payload },
        };
    },
    undoable: true,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
});
