import { normalizePromptText } from './normalizePromptText';
import { type PromptClause } from './promptScope';

type PromptClauseSpan = PromptClause & {
    end: number;
    start: number;
};

function isClipFadeValueSeparator({
    maskedPrompt,
    separatorEnd,
    separatorStart,
    start,
}: {
    maskedPrompt: string;
    separatorEnd: number;
    separatorStart: number;
    start: number;
}): boolean {
    const prefix = normalizePromptText(maskedPrompt.slice(start, separatorStart));
    if (!/\bset clip fades?\b/u.test(prefix)) {
        return false;
    }
    const suffix = normalizePromptText(maskedPrompt.slice(separatorEnd));
    return /^(?:fade in|fade out)(?: to| at)? -?\d/u.test(suffix);
}

function isBeatDurationValueSeparator({
    maskedPrompt,
    separatorEnd,
    separatorStart,
    start,
}: {
    maskedPrompt: string;
    separatorEnd: number;
    separatorStart: number;
    start: number;
}): boolean {
    const prefix = normalizePromptText(maskedPrompt.slice(start, separatorStart));
    const suffix = maskedPrompt.slice(separatorEnd).trim();
    return (
        /\bfit\b.*\bclip\b.*\bbeats?\b/u.test(prefix) &&
        /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?%?\s+beats?\b/u.test(suffix)
    );
}

export function getPromptClauses(prompt: string, maskedPrompt: string): PromptClauseSpan[] {
    const clauses: PromptClauseSpan[] = [];
    const separatorPattern = /\s+(?:and then|then|and|but)\s+|[;,\n]+|\.(?!\d)/giu;
    let start = 0;
    for (const match of maskedPrompt.matchAll(separatorPattern)) {
        const separatorEnd = match.index + match[0].length;
        const normalizedPrefix = normalizePromptText(maskedPrompt.slice(start, match.index));
        const normalizedSuffix = normalizePromptText(maskedPrompt.slice(separatorEnd));
        const normalizedSeparator = normalizePromptText(match[0]);
        const isValidatedListSeparator = normalizedSeparator === 'and' || match[0].trim() === ',';
        const isVcaMemberListSeparator =
            isValidatedListSeparator &&
            /^(?:create|add) vca group\b/u.test(normalizedPrefix) &&
            /\bfor\b/u.test(normalizedPrefix) &&
            !/\b(?:named|called)\b/u.test(normalizedPrefix) &&
            /\b(?:named|called)\b/u.test(normalizedSuffix);
        if (
            isVcaMemberListSeparator ||
            isClipFadeValueSeparator({
                maskedPrompt,
                separatorEnd,
                separatorStart: match.index,
                start,
            }) ||
            isBeatDurationValueSeparator({
                maskedPrompt,
                separatorEnd,
                separatorStart: match.index,
                start,
            })
        ) {
            continue;
        }
        if (prompt.slice(start, match.index).trim().length > 0) {
            clauses.push({
                end: match.index,
                masked: maskedPrompt.slice(start, match.index),
                start,
                text: prompt.slice(start, match.index),
            });
        }
        start = separatorEnd;
    }
    if (prompt.slice(start).trim().length > 0) {
        clauses.push({ end: prompt.length, masked: maskedPrompt.slice(start), start, text: prompt.slice(start) });
    }
    return clauses;
}
