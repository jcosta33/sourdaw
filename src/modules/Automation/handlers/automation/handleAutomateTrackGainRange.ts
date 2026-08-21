import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { applyTrackGainAutomationRange } from '../../useCases/automation/applyTrackGainAutomationRange';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type AutomateTrackGainRangeAction = Extract<AppAction, { type: 'automateTrackGainRange' }>;
type MaterializedPayload = AutomateTrackGainRangeAction['payload'] & {
    sectionId: string;
    startBeat: number;
    endBeat: number;
    expectedTracks: NonNullable<AutomateTrackGainRangeAction['payload']['expectedTracks']>;
    expectedSection: NonNullable<AutomateTrackGainRangeAction['payload']['expectedSection']>;
};

function getMaterializedPayload(action: AutomateTrackGainRangeAction): MaterializedPayload | null {
    const payload = action.payload;
    if (
        payload.sectionId === undefined ||
        payload.startBeat === undefined ||
        payload.endBeat === undefined ||
        payload.expectedTracks === undefined ||
        payload.expectedSection === undefined
    ) {
        return null;
    }
    return {
        ...payload,
        sectionId: payload.sectionId,
        startBeat: payload.startBeat,
        endBeat: payload.endBeat,
        expectedTracks: payload.expectedTracks,
        expectedSection: payload.expectedSection,
    };
}

function currentStateMatches(payload: MaterializedPayload): boolean {
    const section = markerStore.value?.sections.find((candidate) => candidate.id === payload.sectionId);
    if (
        !section ||
        section.name !== payload.expectedSection.name ||
        section.startBeat !== payload.expectedSection.startBeat ||
        section.endBeat !== payload.expectedSection.endBeat ||
        payload.sectionName !== payload.expectedSection.name ||
        payload.startBeat !== payload.expectedSection.startBeat ||
        payload.endBeat !== payload.expectedSection.endBeat ||
        payload.trackIds.length !== payload.expectedTracks.length ||
        !payload.trackIds.every((trackId, index) => trackId === payload.expectedTracks[index]?.trackId)
    ) {
        return false;
    }
    const automationState = getAutomationStoreState();
    if (!automationState) {
        return false;
    }
    return payload.expectedTracks.every((expected) => {
        const track = trackStore.value?.tracks.find((candidate) => candidate.id === expected.trackId);
        return (
            track?.kind === 'bus' &&
            track.name === expected.trackName &&
            track.gain === expected.gain &&
            Number.isFinite(track.gain) &&
            track.gain > 0 &&
            track.gain * 10 ** (payload.gainDb / 20) <= FADER_MAX_GAIN &&
            track.automationMode === expected.automationMode &&
            track.frozen === expected.frozen &&
            !automationState.lanes.some(
                (lane) =>
                    lane.id === `auto-gain-${encodeURIComponent(expected.trackId)}` ||
                    (!lane.clipId && lane.trackId === expected.trackId && lane.parameterId === 'gain')
            )
        );
    });
}

export const handleAutomateTrackGainRange = createHandler<'automateTrackGainRange'>({
    execute: (action) => {
        const payload = getMaterializedPayload(action);
        if (!payload || !currentStateMatches(payload)) {
            return { status: 'conflict' };
        }
        const written = applyTrackGainAutomationRange({
            startBeat: payload.startBeat,
            endBeat: payload.endBeat,
            gainDb: payload.gainDb,
            expectedTracks: payload.expectedTracks,
        });
        return written ? { status: 'written' } : { status: 'conflict' };
    },
    describe: (action) => {
        const payload = getMaterializedPayload(action);
        let label = 'Automate track gain range';
        if (payload) {
            const targets = payload.expectedTracks.map((track) => `"${track.trackName}" (${track.trackId})`).join(', ');
            label = `Lift ${targets} by ${String(payload.gainDb)} dB only in ${payload.sectionName} beats ${String(payload.startBeat)}–${String(payload.endBeat)}`;
        }
        if (!payload || !currentStateMatches(payload)) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: { type: 'removeTrackGainAutomationRange', payload },
        };
    },
    undoable: true,
});
