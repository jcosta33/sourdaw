import { toDrumKitVoice } from './toDrumKitVoice';

import type { DrumKit, NativeDrumKit } from './helpers';

export function toDrumKit(kit: NativeDrumKit | null): DrumKit | null {
    if (!kit) {
        return null;
    }

    return {
        id: kit.id,
        name: kit.name,
        voices: kit.voices.map(toDrumKitVoice),
    };
}
