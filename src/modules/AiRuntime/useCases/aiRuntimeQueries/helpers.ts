import { type PATTERN_TEMPLATES as modelPatternTemplates, resolveTemplateScale } from '../../models/MidiPatternLibrary';
import { type PRESET_ACTIONS } from '../../models/PresetActions/Registry';

export type MixIssue = {
    severity: 'info' | 'warning' | 'critical';
    category: 'level' | 'frequency' | 'stereo' | 'dynamics';
    message: string;
    trackId?: string;
};

export type MixAnalysis = {
    timestamp: number;
    overallLevel: { peakDb: number; rmsDb: number };
    frequencyBalance: {
        sub: number;
        bass: number;
        lowMid: number;
        mid: number;
        highMid: number;
        high: number;
    };
    trackLevels: Array<{
        trackId: string;
        trackName: string;
        peakDb: number;
        rmsDb: number;
        isMuted: boolean;
        isSoloed: boolean;
        isClipping: boolean;
    }>;
    issues: MixIssue[];
    suggestions: string[];
};

export type PresetSearchContext = {
    selectedTrackId: string | undefined;
    selectedClipId: string | undefined;
    selectedClipType: 'audio' | 'midi' | undefined;
    trackCount: number;
};

export type PromptPresetCategory =
    | 'Transport'
    | 'Track'
    | 'Clip'
    | 'MIDI'
    | 'Device'
    | 'Workspace'
    | 'Mix'
    | 'Generate'
    | 'File'
    | 'Automation'
    | 'Collaboration';

export type PromptPreset = {
    id: string;
    label: string;
    category: PromptPresetCategory;
    isDestructive: boolean;
};

export type PatternTemplateModel = (typeof modelPatternTemplates)[number];
export type PatternTemplateInput = Parameters<PatternTemplateModel['generate']>[0];
export type PatternTemplateOutput = ReturnType<PatternTemplateModel['generate']>;

export function toPublicPatternTemplate(template: PatternTemplateModel) {
    return {
        id: template.id,
        name: template.name,
        category: template.category,
        genres: [...template.genres],
        tags: [...template.tags],
        description: template.description,
        // §14.6 / G6 — apply the template's `scaleOverride` at the boundary so
        // downstream consumers (AI handlers, external callers) automatically
        // generate on the template's required scale without re-implementing
        // the resolution rule.
        generate: (params: PatternTemplateInput): PatternTemplateOutput =>
            template
                .generate({ ...params, scale: resolveTemplateScale(template, params) })
                .map((note) => ({ ...note })),
        lengthBeats: template.lengthBeats,
    };
}

export function toPromptPreset(preset: (typeof PRESET_ACTIONS)[number]): PromptPreset {
    return {
        id: preset.id,
        label: preset.label,
        category: preset.category,
        isDestructive: preset.isDestructive ?? false,
    };
}

export { NATIVE_MODEL_INFO, CLOUD_MODEL_INFO, WEBLLM_MODELS, type ModelInfo } from '../../models/ModelInfo';
export { isComplexPrompt } from '../../transformers/promptParser/parsing';
