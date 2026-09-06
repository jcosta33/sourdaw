/**
 * Lightweight fuzzy search over preset actions.
 *
 * No external dependencies. Scores each preset against user input tokens
 * using substring and prefix matching on label + keywords.
 */

import {
    PRESET_ACTIONS,
    CATEGORY_ORDER,
    type PresetAction,
    type PresetContext,
    type PresetCategory,
} from '../models/PresetActions/Registry';

export type FuzzyResult = {
    preset: PresetAction;
    score: number;
};

// ── Main search API ─────────────────────────────────────────────────────

/**
 * Search presets by query, returning the top `limit` results ranked by score.
 * Filters out presets whose selection requirements aren't met by the context.
 */
export function searchPresets(query: string, context: PresetContext, limit = 12): FuzzyResult[] {
    const trimmed = query.trim().toLowerCase();

    // Empty query → return all available presets grouped by category
    if (trimmed.length === 0) {
        return getAvailablePresets(context)
            .slice(0, limit)
            .map((preset) => ({
                preset,
                score: 0,
            }));
    }

    const tokens = trimmed.split(/\s+/);
    const results: FuzzyResult[] = [];

    for (const preset of PRESET_ACTIONS) {
        if (!isPresetAvailable(preset, context)) {
            continue;
        }

        const score = scorePreset(preset, tokens, trimmed);
        if (score > 0) {
            results.push({ preset, score });
        }
    }

    results.sort((alpha, b) => b.score - alpha.score);
    return results.slice(0, limit);
}

/**
 * Get all available presets for the current context, grouped by category.
 */
export function getAvailablePresets(context: PresetContext): PresetAction[] {
    const available = PRESET_ACTIONS.filter((param) => isPresetAvailable(param, context));

    // Sort by category order
    const categoryIndex = new Map<PresetCategory, number>();
    for (const [index, cat] of CATEGORY_ORDER.entries()) {
        categoryIndex.set(cat, index);
    }

    available.sort((alpha, b) => {
        const ai = categoryIndex.get(alpha.category) ?? 99;
        const bi = categoryIndex.get(b.category) ?? 99;
        return ai - bi;
    });

    return available;
}

// ── Scoring ─────────────────────────────────────────────────────────────

function scorePreset(preset: PresetAction, tokens: string[], fullQuery: string): number {
    let score = 0;
    const labelLower = preset.label.toLowerCase();
    const allSearchable = [labelLower, ...preset.keywords.map((kIndex) => kIndex.toLowerCase())];

    // Exact label match → highest score
    if (labelLower === fullQuery) {
        return 200;
    }

    // Exact keyword match
    for (const kw of preset.keywords) {
        if (kw.toLowerCase() === fullQuery) {
            return 180;
        }
    }

    // Label starts with query
    if (labelLower.startsWith(fullQuery)) {
        score += 100;
    }

    // Any keyword starts with query
    for (const kw of preset.keywords) {
        if (kw.toLowerCase().startsWith(fullQuery)) {
            score = Math.max(score, 90);
        }
    }

    // Token matching: each token that appears in any searchable string
    let matchedTokens = 0;
    for (const token of tokens) {
        let tokenMatched = false;
        for (const searchable of allSearchable) {
            if (searchable.includes(token)) {
                tokenMatched = true;

                // Bonus for prefix match in a word boundary
                const words = searchable.split(/[\s\-/]+/);
                for (const word of words) {
                    if (word.startsWith(token)) {
                        score += 15;
                        break;
                    }
                }

                score += 10;
                break;
            }
        }
        if (tokenMatched) {
            matchedTokens++;
        }
    }

    // All tokens must match for a meaningful score
    if (matchedTokens < tokens.length) {
        return 0;
    }

    // Bonus for matching most tokens
    if (tokens.length > 1 && matchedTokens === tokens.length) {
        score += 20;
    }

    // Substring match of full query in label
    if (labelLower.includes(fullQuery)) {
        score += 30;
    }

    // Category keyword match (approximate the user's intent)
    const lastToken = tokens[tokens.length - 1]!;
    if (preset.category.toLowerCase().startsWith(lastToken)) {
        score += 5;
    }

    return score;
}

// ── Availability check ──────────────────────────────────────────────────

function isPresetAvailable(preset: PresetAction, context: PresetContext): boolean {
    switch (preset.requiresSelection) {
        case 'track':
            return context.selectedTrackId !== undefined;
        case 'clip':
            return context.selectedClipId !== undefined;
        case 'clipMidi':
            return context.selectedClipId !== undefined && context.selectedClipType === 'midi';
        case 'clipAudio':
            return context.selectedClipId !== undefined && context.selectedClipType === 'audio';
        case undefined:
        default:
            return true;
    }
}
