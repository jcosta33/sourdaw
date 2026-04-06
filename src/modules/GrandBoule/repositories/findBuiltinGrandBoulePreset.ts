/**
 * Look up a shipped Grand Boule preset by id.
 */

import { type GrandBoulePreset } from '../models/GrandBoulePreset';
import { listBuiltinGrandBoulePresets } from './grandBoulePresetCatalog';

export const findBuiltinGrandBoulePreset = (presetId: string): GrandBoulePreset | null => {
    const match = listBuiltinGrandBoulePresets().find((preset) => preset.id === presetId);
    return match ?? null;
};
