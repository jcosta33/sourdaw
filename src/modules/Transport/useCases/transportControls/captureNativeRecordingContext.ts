import { type startNativeLiveGraphSession } from '#/modules/AudioEngine/useCases';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';

import { samplesToBeat, secondsBetweenBeats } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { DEFAULT_TEMPO_BPM, transportStore } from '../../stores/transportStore';

/** Freeze geometry and its separate root authority at issue time, before any reply. */
export function captureNativeRecordingContext(): Required<
    Pick<Parameters<typeof startNativeLiveGraphSession>[0], 'recordingGeometry' | 'recordingOwner'>
> {
    const state = transportStore.value;
    const tempo = state?.tempo ?? DEFAULT_TEMPO_BPM;
    const changes = structuredClone(tempoMapStore.value?.changes ?? []);
    const rootIdentity = captureProjectRootIdentity();
    return {
        recordingOwner: { identity: rootIdentity, isCurrent: () => captureProjectRootIdentity() === rootIdentity },
        recordingGeometry: {
            secondsAtBeat: (beat) => secondsBetweenBeats(changes, 0, beat, tempo),
            beatAtSeconds: (seconds) => samplesToBeat(changes, seconds, tempo, 1),
            isLooping: state?.isLooping ?? false,
            loopStart: state?.loopStart ?? 0,
            loopEnd: state?.loopEnd ?? 0,
        },
    };
}
