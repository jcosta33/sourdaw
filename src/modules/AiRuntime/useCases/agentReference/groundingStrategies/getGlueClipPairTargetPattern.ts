import { type ProjectContext } from '../../../models/ProjectContext';

import { escapeRegExp } from './escapeRegExp';
import { normalizePromptText } from './normalizePromptText';

export function getGlueClipPairTargetPattern(assertedClipIds: unknown, context: ProjectContext): string | null {
    if (
        !Array.isArray(assertedClipIds) ||
        assertedClipIds.length !== 2 ||
        !assertedClipIds.every((clipId): clipId is string => typeof clipId === 'string')
    ) {
        return null;
    }
    const clips = assertedClipIds.map((clipId) =>
        context.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)
    );
    if (clips.some((clip) => !clip)) {
        return null;
    }
    function getReferencePattern(clip: NonNullable<(typeof clips)[number]>): string {
        const references = [clip.id, clip.name]
            .map(normalizePromptText)
            .filter((reference) => reference.length > 0)
            .toSorted((left, right) => right.length - left.length)
            .map(escapeRegExp);
        return `(?:${references.join('|')})`;
    }
    function orderedPair(left: string, right: string): string {
        const leftTarget = `(?:the )?(?:clip )?${left}(?: clips?)?`;
        const rightTarget = `(?:the )?(?:clip )?${right}(?: clips?)?`;
        return `${leftTarget} (?:and|with) ${rightTarget}`;
    }
    const first = getReferencePattern(clips[0]!);
    const second = getReferencePattern(clips[1]!);
    return `(?:${orderedPair(first, second)}|${orderedPair(second, first)})`;
}
