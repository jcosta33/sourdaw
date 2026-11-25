import { type ProjectContext } from '../../../models/ProjectContext';

import { escapeRegExp } from './escapeRegExp';
import { normalizePromptText } from './normalizePromptText';

/** The glyph a masked project reference is written in, one per character; the constraint readers read it from here. */
export const PROJECT_REFERENCE_MASK_GLYPH = '□';

export const reservedVcaGroupReferenceWords: ReadonlySet<string> = new Set(['group', 'vca', 'vca group']);

function getProjectReferenceTexts(context: ProjectContext): string[] {
    const vcaReferences = (context.vcaGroups ?? [])
        .flatMap((group) => [group.id, group.name])
        .filter((reference) => !reservedVcaGroupReferenceWords.has(normalizePromptText(reference)));
    const references = [
        ...vcaReferences,
        ...context.tracks.flatMap((track) => [
            track.id,
            track.name,
            ...track.devices.flatMap((device) => [
                device.id,
                device.type,
                ...(device.parameters ?? []).flatMap((parameter) => [parameter.id, parameter.name]),
            ]),
            ...track.clips.flatMap((clip) => [clip.id, clip.name]),
        ]),
    ];
    return [...new Set(references)]
        .filter((reference) => reference.length > 0)
        .sort((left, right) => right.length - left.length);
}

const reservedClipReferenceWords: ReadonlySet<string> = new Set([
    'track',
    'clip',
    'device',
    'bus',
    'master',
    'output',
    'send',
    'parameter',
    'remove',
    'delete',
    'rename',
    'duplicate',
    'copy',
    'trim',
    'start',
    'end',
    'nudge',
    'gain',
    'volume',
]);

function getSemanticClipReferenceTexts(context: ProjectContext): string[] {
    const clipReferences = context.tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.id, clip.name]));
    return [...new Set(clipReferences)]
        .filter((reference) => reference.length >= 'clip'.length)
        .filter((reference) => !reservedClipReferenceWords.has(normalizePromptText(reference)))
        .sort((left, right) => right.length - left.length);
}

type PromptRange = {
    end: number;
    start: number;
};

type PromptMatch = PromptRange & {
    value: string;
};

type ProjectReferenceMaskSpan = PromptRange & {
    replacement: string;
};

type CountedDuration = PromptRange & {
    numberEnd: number;
};

const countedDurationPattern = /(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)[-\s]*(?:beats?|bars?|measures?)(?![\p{L}\p{N}])/giu;

function overlaps(left: PromptRange, right: PromptRange): boolean {
    return left.start < right.end && right.start < left.end;
}

function findPromptMatches(prompt: string, pattern: RegExp): PromptMatch[] {
    return [...prompt.matchAll(pattern)].flatMap((match) => {
        const start = match.index;
        const value = match[0];
        if (start === undefined || !value) {
            return [];
        }
        return [{ start, end: start + value.length, value }];
    });
}

function findReferenceMatches(prompt: string, references: readonly string[]): PromptMatch[] {
    return references.flatMap((reference) =>
        findPromptMatches(prompt, new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(reference)}(?![\\p{L}\\p{N}])`, 'giu'))
    );
}

function findCountedDurations(prompt: string): CountedDuration[] {
    return [...prompt.matchAll(countedDurationPattern)].flatMap((match) => {
        const start = match.index;
        const number = match[1] ?? '';
        if (start === undefined || !number) {
            return [];
        }
        return [{ start, end: start + match[0].length, numberEnd: start + number.length }];
    });
}

const explicitEntitySuffixPattern = /^\s+(?:clip|track|device|bus|master|output|send|parameter)\b/iu;

function isFollowedByEntityWord(prompt: string, end: number): boolean {
    return explicitEntitySuffixPattern.test(prompt.slice(end));
}

function namesDurationNumber(prompt: string, reference: PromptRange, duration: CountedDuration): boolean {
    if (duration.numberEnd > reference.end) {
        return false;
    }
    return reference.start < duration.start || isFollowedByEntityWord(prompt, reference.end);
}

/**
 * A counted duration the request states ("4 beat", "2-bar", "8--beats") is not an object reference,
 * unless a reference name covers its number and either starts before it ("Take 2" in "mute Take 2
 * Beat", "Verse and Chorus 8 Bars") or is followed by an entity word ("8 Bars" in "mute the 8 Bars
 * clip"): then the number belongs to that name. A name starting at the number and followed by
 * nothing of the kind ("4 Bar Loop" in "a 4 bar loop") or none covering it ("4" in "for 4 beats")
 * leaves the duration counted.
 */
function findProtectedCountedDurations(prompt: string, references: readonly string[]): PromptRange[] {
    const referenceMatches = findReferenceMatches(prompt, references);
    return findCountedDurations(prompt).filter(
        (duration) => !referenceMatches.some((match) => namesDurationNumber(prompt, match, duration))
    );
}

type ProjectReferenceMaskState = {
    protectedRanges: PromptRange[];
    spans: ProjectReferenceMaskSpan[];
};

/**
 * A reference match that runs into a protected duration is itself skipped, and so is every later
 * match inside it: a nested name ("Drums" in "8 Bars Drums") must not mask a fragment of its container.
 */
function collectProjectReferenceMaskSpans(
    prompt: string,
    references: readonly string[],
    state: ProjectReferenceMaskState,
    getReplacement: (match: string, end: number) => string
): void {
    for (const match of findReferenceMatches(prompt, references)) {
        if (state.protectedRanges.some((range) => overlaps(range, match))) {
            state.protectedRanges.push(match);
            continue;
        }
        if (state.spans.some((span) => overlaps(span, match))) {
            continue;
        }
        state.spans.push({ start: match.start, end: match.end, replacement: getReplacement(match.value, match.end) });
    }
}

export function maskProjectReferences(prompt: string, context: ProjectContext): string {
    const semanticReferences = getSemanticClipReferenceTexts(context);
    const projectReferences = getProjectReferenceTexts(context);
    const state: ProjectReferenceMaskState = {
        protectedRanges: findProtectedCountedDurations(prompt, [...semanticReferences, ...projectReferences]),
        spans: [],
    };
    collectProjectReferenceMaskSpans(prompt, semanticReferences, state, (match, end) => {
        if (isFollowedByEntityWord(prompt, end)) {
            return PROJECT_REFERENCE_MASK_GLYPH.repeat(match.length);
        }
        return `clip${PROJECT_REFERENCE_MASK_GLYPH.repeat(match.length - 'clip'.length)}`;
    });
    collectProjectReferenceMaskSpans(prompt, projectReferences, state, (match) =>
        PROJECT_REFERENCE_MASK_GLYPH.repeat(match.length)
    );

    let maskedPrompt = '';
    let cursor = 0;
    for (const span of state.spans.toSorted((left, right) => left.start - right.start)) {
        maskedPrompt += prompt.slice(cursor, span.start);
        maskedPrompt += span.replacement;
        cursor = span.end;
    }
    return maskedPrompt + prompt.slice(cursor);
}
