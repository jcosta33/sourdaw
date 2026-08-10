import { buildTrackGainAutomationRangeLane } from '../../services/buildTrackGainAutomationRangeLane';
import { automationStore } from '../../stores/automationStore';

type ApplyTrackGainAutomationRangeInput = {
    endBeat: number;
    expectedTracks: Array<{ trackId: string; trackName: string; gain: number }>;
    gainDb: number;
    startBeat: number;
};

export function applyTrackGainAutomationRange(input: ApplyTrackGainAutomationRangeInput): boolean {
    const state = automationStore.value;
    if (!state) {
        return false;
    }
    const lanes = input.expectedTracks.map((track) =>
        buildTrackGainAutomationRangeLane({
            trackId: track.trackId,
            trackName: track.trackName,
            baseGain: track.gain,
            startBeat: input.startBeat,
            endBeat: input.endBeat,
            gainDb: input.gainDb,
        })
    );
    automationStore.set({ lanes: [...state.lanes, ...lanes] });
    return true;
}
