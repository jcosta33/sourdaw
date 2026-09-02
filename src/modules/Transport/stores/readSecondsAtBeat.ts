import { secondsBetweenBeats } from '../models/TempoMap';

import { tempoMapStore } from './tempoMapStore';
import { transportStore } from './transportStore';

type ReadSecondsAtBeatInput = {
    beat: number;
};

/**
 * Song time in seconds at `beat`, integrating every tempo change and ramp from
 * the start of the timeline.
 *
 * The seconds-domain counterpart of {@link readTempoAtBeat}, and the read a
 * foreign module wants whenever it has to place a beat on the wall clock: the
 * tempo at a beat says nothing about the span behind it, so dividing by it is
 * right only while that span holds no tempo change.
 */
export function readSecondsAtBeat({ beat }: ReadSecondsAtBeatInput): number {
    return secondsBetweenBeats(tempoMapStore.value?.changes ?? [], 0, beat, transportStore.value?.tempo ?? 120);
}
