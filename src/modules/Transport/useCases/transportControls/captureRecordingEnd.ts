import { getAudioContext } from '#/modules/AudioEngine/useCases';

import { samplesToBeat, secondsBetweenBeats } from '../../models/TempoMap';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { captureGestureBeat } from '../../stores/captureGestureBeat';
import { tempoMapStore } from '../../stores/tempoMapStore';

/** Freeze the ending gesture's clock conversion before a capture flush can edit it. */
export function captureRecordingEnd() {
    const transport = getTransportState();
    if (!transport) {
        return undefined;
    }
    const contextSeconds = getAudioContext().currentTime;
    const beat = captureGestureBeat();
    const tempo = transport.tempo;
    const changes = structuredClone(tempoMapStore.value?.changes ?? []);
    const songSeconds = secondsBetweenBeats(changes, 0, beat, tempo);
    return {
        contextSeconds,
        beatAtContextSeconds: (seconds: number): number =>
            samplesToBeat(changes, songSeconds + seconds - contextSeconds, tempo, 1),
    };
}
