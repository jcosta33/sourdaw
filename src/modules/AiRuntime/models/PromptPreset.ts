import { type PresetCategory } from './PresetActions/Registry';

export type PromptPreset = {
    id: string;
    label: string;
    category: PresetCategory;
    isDestructive: boolean;
};
