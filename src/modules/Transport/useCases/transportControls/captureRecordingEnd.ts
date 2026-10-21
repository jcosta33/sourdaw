import { getAudioContext } from '#/modules/AudioEngine/useCases';

import { samplesToBeat, secondsBetweenBeats } from '../../models/TempoMap';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { captureGestureBeat } from '../../stores/captureGestureBeat';
import { tempoMapStore } from '../../stores/tempoMapStore';

/** Freeze the ending gesture's clock conversion before a capture flush can edit it. */
export function captureRecordingEnd(anchor?: { contextSeconds: number; beat: number }) {
    const transport = getTransportState();
    if (!transport) {
        return undefined;
    }
    const contextSeconds = anchor?.contextSeconds ?? getAudioContext().currentTime;
    const beat = anchor?.beat ?? captureGestureBeat();
    const tempo = transport.tempo;
    const changes = structuredClone(tempoMapStore.value?.changes ?? []);
    const songSeconds = secondsBetweenBeats(changes, 0, beat, tempo);
    return {
        contextSeconds,
        beatAtContextSeconds: (seconds: number): number =>
            samplesToBeat(changes, songSeconds + seconds - contextSeconds, tempo, 1),
    };
}
