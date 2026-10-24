import { type startNativeLiveGraphSession } from '#/modules/AudioEngine/useCases';

import { samplesToBeat, secondsBetweenBeats } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { DEFAULT_TEMPO_BPM, transportStore } from '../../stores/transportStore';

/** Freeze authored geometry with the maps command, rather than its later reply. */
export function captureNativeRecordingGeometry(): NonNullable<
    Parameters<typeof startNativeLiveGraphSession>[0]['recordingGeometry']
> {
    const state = transportStore.value;
    const tempo = state?.tempo ?? DEFAULT_TEMPO_BPM;
    const changes = structuredClone(tempoMapStore.value?.changes ?? []);
    return {
        secondsAtBeat: (beat) => secondsBetweenBeats(changes, 0, beat, tempo),
        beatAtSeconds: (seconds) => samplesToBeat(changes, seconds, tempo, 1),
        isLooping: state?.isLooping ?? false,
        loopStart: state?.loopStart ?? 0,
        loopEnd: state?.loopEnd ?? 0,
    };
}
