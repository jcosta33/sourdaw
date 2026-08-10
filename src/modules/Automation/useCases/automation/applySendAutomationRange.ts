import { buildSendAutomationRangeLane } from '../../services/buildSendAutomationRangeLane';
import { automationStore } from '../../stores/automationStore';

type ApplySendAutomationRangeInput = {
    busId: string;
    busName: string;
    endBeat: number;
    expectedSends: Array<{ trackId: string; level: number }>;
    reductionDb: number;
    startBeat: number;
};

export function applySendAutomationRange(input: ApplySendAutomationRangeInput): boolean {
    const state = automationStore.value;
    if (!state) {
        return false;
    }
    const lanes = input.expectedSends.map((send) =>
        buildSendAutomationRangeLane({
            trackId: send.trackId,
            busId: input.busId,
            busName: input.busName,
            baseLevel: send.level,
            startBeat: input.startBeat,
            endBeat: input.endBeat,
            reductionDb: input.reductionDb,
        })
    );
    automationStore.set({ lanes: [...state.lanes, ...lanes] });
    return true;
}
