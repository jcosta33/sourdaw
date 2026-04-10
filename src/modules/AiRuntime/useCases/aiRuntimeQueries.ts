/**
 * AiRuntime Queries — use case layer exposing AiRuntime state
 * to cross-module consumers.
 */

import { mixAnalysisStore } from '../stores/mixAnalysisStore';
import {
    NATIVE_MODEL_INFO,
    WEBLLM_MODEL_INFO,
    CLOUD_MODEL_INFO,
    WEBLLM_MODELS,
    type ModelInfo,
} from '../models/ModelInfo';
import {
    searchPresets as searchInternalPresets,
    getAvailablePresets as getAvailableInternalPresets,
} from '../services/fuzzySearch';
import { PRESET_ACTIONS } from '../models/presetActions/registry';
import {
    PATTERN_TEMPLATES as modelPatternTemplates,
    filterTemplates as filterModelTemplates,
} from '../models/midiPatternLibrary';

export type MixAnalysisState = NonNullable<typeof mixAnalysisStore.value>;

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

type PresetSearchContext = {
    selectedTrackId: string | undefined;
    selectedClipId: string | undefined;
    selectedClipType: 'audio' | 'midi' | undefined;
    trackCount: number;
};

type PromptPresetCategory =
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

type PromptPreset = {
    id: string;
    label: string;
    category: PromptPresetCategory;
    isDestructive: boolean;
};

export type FuzzyResult = {
    preset: PromptPreset;
    score: number;
};

type PatternTemplateModel = (typeof modelPatternTemplates)[number];
type PatternTemplateInput = Parameters<PatternTemplateModel['generate']>[0];
type PatternTemplateOutput = ReturnType<PatternTemplateModel['generate']>;
type PatternTemplateFilters = Parameters<typeof filterModelTemplates>[0];

function toPublicPatternTemplate(template: PatternTemplateModel) {
    return {
        id: template.id,
        name: template.name,
        category: template.category,
        genres: [...template.genres],
        tags: [...template.tags],
        description: template.description,
        generate: (params: PatternTemplateInput): PatternTemplateOutput =>
            template.generate(params).map((note) => ({ ...note })),
        lengthBeats: template.lengthBeats,
    };
}

export const PATTERN_TEMPLATES = modelPatternTemplates.map(toPublicPatternTemplate);

export function filterTemplates(filters: PatternTemplateFilters) {
    return filterModelTemplates(filters).map(toPublicPatternTemplate);
}

function toPromptPreset(preset: (typeof PRESET_ACTIONS)[number]): PromptPreset {
    return {
        id: preset.id,
        label: preset.label,
        category: preset.category,
        isDestructive: preset.isDestructive ?? false,
    };
}

export function searchPresets(query: string, context: PresetSearchContext, limit = 12): FuzzyResult[] {
    return searchInternalPresets(query, context, limit).map((result) => ({
        preset: toPromptPreset(result.preset),
        score: result.score,
    }));
}

export function getAvailablePresets(context: PresetSearchContext): PromptPreset[] {
    return getAvailableInternalPresets(context).map(toPromptPreset);
}

export type ResolvePresetActionsInput = {
    presetId: string;
    context: PresetSearchContext;
};

export function resolvePresetActions({ presetId, context }: ResolvePresetActionsInput) {
    const preset = PRESET_ACTIONS.find((candidate) => candidate.id === presetId);
    if (!preset) {
        return [];
    }

    const actionResult = preset.buildAction(context);
    if (actionResult === null) {
        return [];
    }

    return Array.isArray(actionResult) ? actionResult : [actionResult];
}

export { NATIVE_MODEL_INFO, WEBLLM_MODEL_INFO, CLOUD_MODEL_INFO, WEBLLM_MODELS };
export type { ModelInfo };
export { getActiveModelId } from '../repositories/webLlm/engineLifecycle';

/** Get the mix analysis store value. */
export function getMixAnalysisStoreValue(): typeof mixAnalysisStore.value {
    return mixAnalysisStore.value;
}

/** Set the mix analysis store value. */
export function setMixAnalysisStoreValue(state: MixAnalysisState): void {
    mixAnalysisStore.set(state);
}

// ─── Cross-module re-exports ───────────────────────────────────────────────────

export { streamCloudChatCompletion } from '../repositories/cloudLlm/cloudInference';
export { readLevels } from '../repositories/mixAnalysis/readLevels';
export { readFrequencyBalance } from '../repositories/mixAnalysis/readFrequencyBalance';
export { detectIssues, generateSuggestions } from '../transformers/mixAnalysisTransformers';
export { generateWebLlmCompletion } from '../repositories/webLlm/engineLifecycle';
export { generateNativeCompletion } from '../repositories/nativeEngine/completions';
export { isNativeEngineReady } from '../repositories/nativeEngine/lifecycle';
export { isComplexPrompt } from '../transformers/promptParser/parsing';
