import { type SendAutomationRangeSnapshot } from '#/utils/handlerContract';

import { buildSendAutomationRangesLane } from '../../services/buildSendAutomationRangesLane';
import { automationStore } from '../../stores/automationStore';

type ApplySendAutomationRangesInput = {
    busId: string;
    busName: string;
    expectedTracks: Array<{ trackId: string; sendLevel: number }>;
    ranges: readonly SendAutomationRangeSnapshot[];
    targetLevelDb: number;
};

export function applySendAutomationRanges(input: ApplySendAutomationRangesInput): boolean {
    const state = automationStore.value;
    if (!state) {
        return false;
    }
    const lanes = input.expectedTracks.map((track) =>
        buildSendAutomationRangesLane({
            trackId: track.trackId,
            busId: input.busId,
            busName: input.busName,
            baseLevel: track.sendLevel,
            targetLevelDb: input.targetLevelDb,
            ranges: input.ranges,
        })
    );
    automationStore.set({ lanes: [...state.lanes, ...lanes] });
    return true;
}
