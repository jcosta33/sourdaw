import { samplesToBeat } from '../models/TempoMap';

import { tempoMapStore } from './tempoMapStore';
import { DEFAULT_TEMPO_BPM, transportStore } from './transportStore';

type ReadBeatAtSamplesInput = {
    /** Absolute timeline samples from the start of the timeline. */
    samples: number;
    /** The rate `samples` was counted at; it cancels inside the conversion. */
    sampleRate: number;
};

/**
 * The beat that sounds at absolute timeline `samples` — the canonical inverse
 * of {@link readSecondsAtBeat}'s placement read, through the same tempo-map
 * model (`samplesToBeat`), so a caller can map a rendered duration back onto
 * the timeline on the very map playback schedules with.
 *
 * The seconds-domain counterpart of the placement read is the one a foreign
 * module wants whenever it has to place a sample position on the song grid:
 * dividing by the tempo at a beat is right only while the span behind it holds
 * no tempo change.
 */
export function readBeatAtSamples({ samples, sampleRate }: ReadBeatAtSamplesInput): number {
    return samplesToBeat(
        tempoMapStore.value?.changes ?? [],
        samples,
        transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM,
        sampleRate
    );
}
