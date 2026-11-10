import { tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { DEFAULT_TEMPO_BPM } from '#/utils/tempoDefaults';
import { type TempoSourceClock } from '#/utils/tempoSourceClock';

/** The session's tempo clock as a detached value, the one the live scheduler converts every beat against. */
export function captureLiveTempoSourceClock(): TempoSourceClock {
    return {
        tempo: transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM,
        changes: structuredClone(tempoMapStore.value?.changes ?? []),
    };
}
