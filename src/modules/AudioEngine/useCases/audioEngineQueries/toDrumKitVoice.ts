import { cloneSynthParams } from './cloneSynthParams';

import type { DrumKitVoice, NativeDrumKitVoice } from './helpers';

export function toDrumKitVoice(voice: NativeDrumKitVoice): DrumKitVoice {
    return {
        name: voice.name,
        pitchRange: [voice.pitchRange[0], voice.pitchRange[1]],
        params: cloneSynthParams(voice.params),
    };
}
