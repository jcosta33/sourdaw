import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'automateTrackGainRange' }>;

export function materializeTrackGainRange(action: Action, state: MaterializationState): MaterializationStep {
    const { context, tracksById } = state;
    const section = (context.sections ?? []).find(
        (candidate) => candidate.name.toLocaleLowerCase() === action.payload.sectionName.toLocaleLowerCase()
    );
    if (!section) {
        return { status: 'rejected', reason: `Section is unavailable: ${action.payload.sectionName}` };
    }
    const expectedTracks = [];
    for (const trackId of action.payload.trackIds) {
        const track = tracksById.get(trackId);
        if (!track || track.kind !== 'bus') {
            return { status: 'rejected', reason: `Bus is unavailable: ${trackId}` };
        }
        if (
            track.frozen === true ||
            track.automationMode === 'off' ||
            !Number.isFinite(track.gain) ||
            track.gain <= 0 ||
            // The fader's own ceiling, matching what
            // `handleAutomateTrackGainRange` admits. Bounding at unity
            // rejects a lift the fader itself can reach by hand.
            track.gain * 10 ** (action.payload.gainDb / 20) > FADER_MAX_GAIN ||
            (context.automationLanes ?? []).some(
                (lane) =>
                    lane.id === `auto-gain-${encodeURIComponent(trackId)}` ||
                    (!lane.clipId && lane.trackId === trackId && lane.parameterId === 'gain')
            )
        ) {
            return { status: 'rejected', reason: `Bus cannot accept gain automation: ${trackId}` };
        }
        expectedTracks.push({
            trackId,
            trackName: track.name,
            gain: track.gain,
            automationMode: track.automationMode,
            frozen: track.frozen ?? false,
        });
    }
    return {
        status: 'accepted',
        actions: [
            {
                type: 'automateTrackGainRange',
                payload: {
                    ...action.payload,
                    sectionId: section.id,
                    startBeat: section.startBeat,
                    endBeat: section.endBeat,
                    expectedTracks,
                    expectedSection: {
                        name: section.name,
                        startBeat: section.startBeat,
                        endBeat: section.endBeat,
                    },
                },
            },
        ],
    };
}
