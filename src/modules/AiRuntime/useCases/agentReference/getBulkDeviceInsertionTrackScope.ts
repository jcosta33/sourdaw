import { type ProjectContext } from '../../models/ProjectContext';

function normalizePromptText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function normalizeDeviceName(value: string): string {
    return normalizePromptText(value.replace(/^builtin-/u, ''));
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
    const targetTracks = matchingTracks.filter((track) => track.frozen !== true);
    const targetIds = targetTracks.map((track) => track.id);
    if (targetIds.length === 0) {
        return null;
    }
    const afterDeviceName = /\bafter ([\p{L}\p{N}]+)\b/iu.exec(normalized)?.[1];
    if (!afterDeviceName) {
        return null;
    }
    const anchors = targetTracks.map((track) => {
        const device = track.devices.find(
            (candidate) =>
                normalizeDeviceName(candidate.name ?? candidate.type) === afterDeviceName ||
                normalizeDeviceName(candidate.type) === afterDeviceName
        );
        return device === undefined ? null : { trackId: track.id, afterDeviceId: device.id };
    });
    if (anchors.some((anchor) => anchor === null)) {
        return null;
    }
    return {
        targetIds,
        anchors: anchors.filter((anchor): anchor is NonNullable<typeof anchor> => anchor !== null),
        excludedFrozenTrackIds: matchingTracks.filter((track) => track.frozen === true).map((track) => track.id),
    };
}
