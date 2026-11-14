import { DEFAULT_TEMPO_BPM, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { type AgentMeasurementTimeline } from './cutAgentMeasurementWindow';

/** The timeline of whichever document's stores answer while this runs. */
export function readAgentMeasurementTimeline(): AgentMeasurementTimeline {
    return { tempo: transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM, changes: tempoMapStore.value?.changes ?? [] };
}
