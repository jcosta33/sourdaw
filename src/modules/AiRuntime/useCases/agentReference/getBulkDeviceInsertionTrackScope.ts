import { type ProjectContext } from '../../models/ProjectContext';

type BulkDeviceInsertionTrackScope = {
    targetIds: string[];
    anchors: { trackId: string; afterDeviceId: string }[];
    excludedFrozenTrackIds: string[];
};

function normalizePromptText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function normalizeDeviceName(value: string): string {
    return normalizePromptText(value.replace(/^builtin-/u, ''));
}

// Mirrors the request boundaries the bridge grounds each action against (getPromptClauses in
// bridgeGroundedLlmToolCalls): a request ends at a coordinating or sequential connector, a
// comma, a semicolon, a newline, or a sentence period.
function splitPromptIntoRequests(prompt: string): string[] {
    return prompt
        .split(/\s+(?:and then|then|and|but)\s+|[;,\n]+|\.(?!\d)/iu)
        .map((request) => request.trim())
        .filter((request) => request !== '');
}

function getRequestedFamilyScope(
    family: string,
    normalizedRequest: string,
    context: ProjectContext
): BulkDeviceInsertionTrackScope | null {
    const familyPattern = new RegExp(`\\b${family.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u');
    const matchingTracks = context.tracks.filter(
        (track) => track.kind !== 'vca' && familyPattern.test(normalizePromptText(track.name))
    );
    const targetTracks = matchingTracks.filter((track) => track.frozen !== true);
    const targetIds = targetTracks.map((track) => track.id);
    if (targetIds.length === 0) {
        return null;
    }
    // Frozen exclusion is scope-derived, not phrase-derived: a frozen track in the matched
    // family is never an insertion target, so it must reach the protection paths no matter
    // how the prompt words the request (#2844).
    const excludedFrozenTrackIds = matchingTracks.filter((track) => track.frozen === true).map((track) => track.id);
    const afterDeviceName = /\bafter ([\p{L}\p{N}]+)\b/iu.exec(normalizedRequest)?.[1];
    if (afterDeviceName === undefined) {
        // A request with no insertion anchor carries no ordering constraint: the scope grounds
        // the batch without anchors and each device appends to its track chain. A request that
        // says "after" yet names no device leaves the ordering underspecified, so it claims
        // no scope and the batch falls back to ordinary per-reference grounding.
        return /\bafter\b/u.test(normalizedRequest) ? null : { targetIds, anchors: [], excludedFrozenTrackIds };
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
        // All-or-nothing on purpose: "after X on every track" is one ordering request, and a
        // target without X has no grounded insertion position. The scope stays null so the
        // batch falls back to ordinary per-reference grounding instead of silently mixing
        // anchored and appended insertions.
        return null;
    }
    return {
        targetIds,
        anchors: anchors.filter((anchor): anchor is NonNullable<typeof anchor> => anchor !== null),
        excludedFrozenTrackIds,
    };
}

export function getBulkDeviceInsertionTrackScope(prompt: string, context: ProjectContext) {
    for (const request of splitPromptIntoRequests(prompt)) {
        const normalized = normalizePromptText(request);
        const family = /\b(?:every|all) ([\p{L}\p{N}]+) tracks?\b/iu.exec(normalized)?.[1];
        // The family phrase and the insertion intent must govern the same request: a family
        // named only by an unrelated clause (a mute or delete request) never grounds insertion.
        if (family === undefined || !/\b(?:insert|add)\b/u.test(normalized)) {
            continue;
        }
        return getRequestedFamilyScope(family, normalized, context);
    }
    return null;
}
