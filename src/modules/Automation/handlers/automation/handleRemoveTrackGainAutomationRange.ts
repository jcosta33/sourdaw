import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { buildTrackGainAutomationRangeLane } from '../../services/buildTrackGainAutomationRangeLane';
import { getAutomationLaneCeiling } from '../../useCases/automation/getAutomationLaneCeiling';
import { removeTrackGainAutomationRange } from '../../useCases/automation/removeTrackGainAutomationRange';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type RemoveTrackGainAutomationRangeAction = Extract<AppAction, { type: 'removeTrackGainAutomationRange' }>;

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
                point.tension === expectedPoint.tension &&
                point.stairSteps === expectedPoint.stairSteps &&
                point.cp1?.x === expectedPoint.cp1?.x &&
                point.cp1?.y === expectedPoint.cp1?.y &&
                point.cp2?.x === expectedPoint.cp2?.x &&
                point.cp2?.y === expectedPoint.cp2?.y
            );
        })
    );
}

/**
 * Compare the two lanes' ceilings through {@link getAutomationLaneCeiling}
 * rather than as stored scalars.
 *
 * `expected` is rebuilt live by `buildTrackGainAutomationRangeLane`, which now
 * ranges a gain lane over the fader law, while `actual` is whatever the
 * document holds. `actionHistoryStore` is a slot of the synced root document,
 * so an entry outlives the session that made it: a "lift the chorus by 3 dB"
 * recorded before the fader widened left a lane storing `1`, the rebuilt
 * expectation is `FADER_MAX_GAIN`, and a raw scalar comparison refuses that
 * undo outright. The derivation reads both as the same ceiling, so an entry
 * recorded on either side of the change still validates — and redo cannot
 * write a lane whose ceiling differs from the one it replaced.
 */
function ceilingMatches(actual: AutomationLane, expected: AutomationLane): boolean {
    return getAutomationLaneCeiling(actual) === getAutomationLaneCeiling(expected);
}

function laneMatches(actual: AutomationLane, expected: AutomationLane): boolean {
    return (
        actual.id === expected.id &&
        actual.trackId === expected.trackId &&
        actual.clipId === expected.clipId &&
        actual.clipAutomationMode === expected.clipAutomationMode &&
        actual.parameterId === expected.parameterId &&
        actual.parameterName === expected.parameterName &&
        pointsMatch(actual.points, expected.points) &&
        actual.trimPoints === expected.trimPoints &&
        actual.objects.length === 0 &&
        actual.ghostPoints === expected.ghostPoints &&
        actual.visible === expected.visible &&
        actual.enabled === expected.enabled &&
        actual.collapsed === expected.collapsed &&
        actual.linkedLaneId === expected.linkedLaneId &&
        actual.linkScale === expected.linkScale &&
        actual.minValue === expected.minValue &&
        ceilingMatches(actual, expected) &&
        actual.viewMinValue === expected.viewMinValue &&
        actual.viewMaxValue === expected.viewMaxValue &&
        actual.color === expected.color
    );
}

function currentStateMatches(action: RemoveTrackGainAutomationRangeAction): boolean {
    const payload = action.payload;
    const section = markerStore.value?.sections.find((candidate) => candidate.id === payload.sectionId);
    const state = getAutomationStoreState();
    if (
        !state ||
        !section ||
        section.name !== payload.expectedSection.name ||
        section.startBeat !== payload.expectedSection.startBeat ||
        section.endBeat !== payload.expectedSection.endBeat ||
        payload.trackIds.length !== payload.expectedTracks.length
    ) {
        return false;
    }
    return payload.expectedTracks.every((expected, index) => {
        if (payload.trackIds[index] !== expected.trackId) {
            return false;
        }
        const track = trackStore.value?.tracks.find((candidate) => candidate.id === expected.trackId);
        const expectedLane = buildTrackGainAutomationRangeLane({
            trackId: expected.trackId,
            trackName: expected.trackName,
            baseGain: expected.gain,
            startBeat: payload.startBeat,
            endBeat: payload.endBeat,
            gainDb: payload.gainDb,
        });
        const actualLane = state.lanes.find((lane) => lane.id === expectedLane.id);
        return (
            track?.kind === 'bus' &&
            track.name === expected.trackName &&
            track.gain === expected.gain &&
            track.automationMode === expected.automationMode &&
            track.frozen === expected.frozen &&
            actualLane !== undefined &&
            laneMatches(actualLane, expectedLane)
        );
    });
}

export const handleRemoveTrackGainAutomationRange = createHandler<'removeTrackGainAutomationRange'>({
    canReapplyAfterDivergence: () => true,
    validate: (action) => currentStateMatches(action),
    execute: (action) => {
        if (!currentStateMatches(action)) {
            return { status: 'conflict' };
        }
        const laneIds = action.payload.expectedTracks.map((track) => `auto-gain-${encodeURIComponent(track.trackId)}`);
        return removeTrackGainAutomationRange(laneIds) ? { status: 'written' } : { status: 'conflict' };
    },
    describe: (action) => ({
        label: `Restore impact-bus gains outside ${action.payload.sectionName}`,
        inverseAction: currentStateMatches(action) ? { type: 'automateTrackGainRange', payload: action.payload } : null,
    }),
    undoable: true,
});
