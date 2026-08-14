import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { buildSendAutomationRangesLane } from '../../services/buildSendAutomationRangesLane';
import { removeSendAutomationRange } from '../../useCases/automation/removeSendAutomationRange';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type RemoveSendAutomationRangesAction = Extract<AppAction, { type: 'removeSendAutomationRanges' }>;

function pointsMatch(actual: readonly AutomationPoint[], expected: readonly AutomationPoint[]): boolean {
    return (
        actual.length === expected.length &&
        actual.every((point, index) => {
            const expectedPoint = expected[index];
            return (
                expectedPoint !== undefined &&
                point.id === expectedPoint.id &&
                point.beat === expectedPoint.beat &&
                point.value === expectedPoint.value &&
                point.curve === expectedPoint.curve &&
                point.tension === expectedPoint.tension
            );
        })
    );
}

function laneMatches(actual: AutomationLane, expected: AutomationLane): boolean {
    return (
        actual.id === expected.id &&
        actual.trackId === expected.trackId &&
        actual.clipId === expected.clipId &&
        actual.parameterId === expected.parameterId &&
        actual.parameterName === expected.parameterName &&
        pointsMatch(actual.points, expected.points) &&
        actual.objects.length === 0 &&
        actual.visible === expected.visible &&
        actual.enabled === expected.enabled &&
        actual.collapsed === expected.collapsed &&
        actual.minValue === expected.minValue &&
        actual.maxValue === expected.maxValue
    );
}

function currentStateMatches(action: RemoveSendAutomationRangesAction): boolean {
    const payload = action.payload;
    const bus = trackStore.value?.tracks.find((track) => track.id === payload.busId);
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
        const send = track?.sends.find((candidate) => candidate.busId === payload.busId);
        const expectedLane = buildSendAutomationRangesLane({
            trackId: expected.trackId,
            busId: payload.busId,
            busName: payload.busName,
            baseLevel: expected.sendLevel,
            targetLevelDb: payload.targetLevelDb,
            ranges: payload.ranges,
        });
        const actualLane = automation.lanes.find((lane) => lane.id === expectedLane.id);
        return (
            payload.trackIds[index] === expected.trackId &&
            track?.name === expected.trackName &&
            track.frozen === expected.frozen &&
            track.automationMode === expected.automationMode &&
            send?.level === expected.sendLevel &&
            send.preFader === expected.sendPreFader &&
            actualLane !== undefined &&
            laneMatches(actualLane, expectedLane)
        );
    });
}

export const handleRemoveSendAutomationRanges = createHandler<'removeSendAutomationRanges'>({
    canReapplyAfterDivergence: () => true,
    validate: (action) => currentStateMatches(action),
    execute: (action) => {
        if (!currentStateMatches(action)) {
            return { status: 'conflict' };
        }
        const laneIds = action.payload.expectedTracks.map(
            (track) => `auto-send-${encodeURIComponent(track.trackId)}-${encodeURIComponent(action.payload.busId)}`
        );
        return removeSendAutomationRange(laneIds) ? { status: 'written' } : { status: 'conflict' };
    },
    describe: (action) => ({
        label: `Remove send ramps for ${action.payload.ranges.map((range) => range.sectionName).join(', ')}`,
        inverseAction: currentStateMatches(action) ? { type: 'automateSendRanges', payload: action.payload } : null,
    }),
    undoable: true,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
});
