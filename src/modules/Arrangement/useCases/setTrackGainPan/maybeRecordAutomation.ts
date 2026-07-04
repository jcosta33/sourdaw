import { type recordAutomationValue } from '#/modules/Automation/useCases';

import { type getTrackById } from '../../repositories/track/getTrackById';
import { type AutomationMode } from '../../stores/trackStore';

import type { transportStore } from '#/modules/Transport/stores';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

type AutomationRecordDeps = {
    getTransportValue: () => (typeof transportStore)['value'];
    getTrackById: typeof getTrackById;
    recordAutomationValue: typeof recordAutomationValue;
};

export function maybeRecordAutomation(
    deps: AutomationRecordDeps,
    trackId: string,
    parameterId: string,
    value: number
): void {
    const transport = deps.getTransportValue();
    if (!transport?.isPlaying) {
        return;
    }

    const track = deps.getTrackById(trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) {
        return;
    }

    deps.recordAutomationValue(trackId, parameterId, value, transport.playheadPosition);
}
