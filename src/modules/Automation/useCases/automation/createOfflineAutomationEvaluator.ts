import { automationStore } from '../../stores/automationStore';

import { getAutomationValueAtBeat } from './getAutomationValueAtBeat';

/** An offline curve reader owns its point and link state for the whole render. */
export function createOfflineAutomationEvaluator(lanes = automationStore.value?.lanes ?? []) {
    const captured = structuredClone(lanes);
    return (laneId: string, beat: number): number | null => getAutomationValueAtBeat(laneId, beat, new Set(), captured);
}
