import { getYeastRack } from '../../stores/yeastStore';
import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';

export const processYeastMidiDependencies = {
    getYeastRack,
    transportStore,
    getAudioContext,
} as const;