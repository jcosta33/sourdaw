import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { getYeastRack } from '../../stores/yeastStore';

export const processYeastMidiDependencies = {
    getYeastRack,
    transportStore,
    getAudioContext,
} as const;
