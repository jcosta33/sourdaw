import { type ProjectContext } from '../../models/ProjectContext';

const trackKinds = new Set(['audio', 'midi', 'bus', 'master', 'folder']);

function normalizePromptText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

export function getMutedEmptyTrackDeletionScope(prompt: string, context: ProjectContext) {
    const normalized = normalizePromptText(prompt);
    if (
        !/\b(?:delete|remove) (?:all|every) muted empty tracks?\b/u.test(normalized) ||
        !/\bpreserve buses? and groups?\b/u.test(normalized)
    ) {
        return null;
    }

    const trackIds = context.tracks.map((track) => track.id);
    if (
        new Set(trackIds).size !== trackIds.length ||
        context.tracks.some(
            (track) =>
                !trackKinds.has(track.kind) ||
                track.clipCount !== track.clips.length ||
                !Array.isArray(track.alternativeClipIds) ||
                track.alternativeClipIds.some((clipId) => typeof clipId !== 'string' || clipId.length === 0)
        )
    ) {
        return null;
    }

    const targets = context.tracks.filter(
        (track) =>
            (track.kind === 'audio' || track.kind === 'midi') &&
            track.muted &&
            track.clips.length === 0 &&
            track.alternativeClipIds?.length === 0
    );
    if (targets.length === 0) {
        return null;
    }

    const structurallyDependentTarget = targets.some(
        (track) => track.vcaGroupId !== null && track.vcaGroupId !== undefined
    );
    const inconsistentVcaMembership = targets.some((track) =>
        (context.vcaGroups ?? []).some((group) => group.trackIds.includes(track.id))
    );
    if (structurallyDependentTarget || inconsistentVcaMembership) {
        return null;
    }

    return {
        targetIds: targets.map((track) => track.id),
        protectedTrackIds: context.tracks
            .filter(
                (track) =>
                    track.kind === 'bus' ||
                    track.kind === 'folder' ||
                    ((track.kind === 'audio' || track.kind === 'midi') &&
                        track.muted &&
                        track.clips.length === 0 &&
                        (track.alternativeClipIds?.length ?? 0) > 0)
            )
            .map((track) => track.id),
    };
}
