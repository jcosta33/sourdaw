import { type ProjectContext } from '../../models/ProjectContext';

function normalizePromptText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

export function getBulkDeviceInsertionTrackScope(prompt: string, context: ProjectContext) {
    const normalized = normalizePromptText(prompt);
    const match = /\b(?:every|all) ([\p{L}\p{N}]+) tracks?\b/iu.exec(normalized);
    const family = match?.[1];
    if (
        !family ||
        !/\b(?:insert|add)\b/u.test(normalized) ||
        !/\bafter\b/u.test(normalized) ||
        !/\bexcluding frozen tracks?\b/u.test(normalized)
    ) {
        return null;
    }
    const familyPattern = new RegExp(`\\b${family.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u');
    const matchingTracks = context.tracks.filter(
        (track) => track.kind !== 'vca' && familyPattern.test(normalizePromptText(track.name))
    );
    const targetIds = matchingTracks.filter((track) => track.frozen !== true).map((track) => track.id);
    if (targetIds.length === 0) {
        return null;
    }
    return {
        targetIds,
        excludedFrozenTrackIds: matchingTracks.filter((track) => track.frozen === true).map((track) => track.id),
    };
}
