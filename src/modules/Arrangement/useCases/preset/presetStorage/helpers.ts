import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

import { type SoundPreset } from '../../../models/SoundPreset';

export const userPresetStorage = createLocalStorage<SoundPreset[]>('sourdaw-user-presets');
