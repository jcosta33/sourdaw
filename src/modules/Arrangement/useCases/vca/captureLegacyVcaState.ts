import { type AppAction } from '#/utils/handlerContract';

import { getVcaGroupsState } from '../../stores/vcaGroupStore';
import { getAllTracks } from '../getAllTracks';

type PublicLegacyVcaAction = Extract<
    AppAction,
    { type: 'createVcaGroup' | 'assignToVca' | 'removeFromVca' | 'setVcaGain' }
>;
type RestoreLegacyVcaStateAction = Extract<AppAction, { type: 'restoreLegacyVcaState' }>;
type LegacyVcaHistoryAction = PublicLegacyVcaAction | RestoreLegacyVcaStateAction;
type RestoreLegacyVcaStatePayload = RestoreLegacyVcaStateAction['payload'];

function emptyPatch(): RestoreLegacyVcaStatePayload {
    return {
        groupRows: [],
        groupGains: [],
        groupMemberships: [],
        trackMemberships: [],
    };
}

function captureCreatePatch(action: Extract<AppAction, { type: 'createVcaGroup' }>): RestoreLegacyVcaStatePayload {
    const groupId = action.payload.vcaGroupId;
    if (!groupId) {
        throw new Error('VCA history capture requires a fixed group identity');
    }

    const groups = getVcaGroupsState();
    const tracks = getAllTracks();
    const trackById = new Map(tracks.map((track) => [track.id, track]));
    const validTrackIds = [...new Set(action.payload.trackIds)].filter((trackId) => trackById.has(trackId));
    const validTrackIdSet = new Set(validTrackIds);
    const groupMemberships: RestoreLegacyVcaStatePayload['groupMemberships'][number][] = [];

    for (const group of groups) {
        for (const [index, trackId] of group.trackIds.entries()) {
            if (!validTrackIdSet.has(trackId)) {
                continue;
            }
            groupMemberships.push({
                groupId: group.id,
                trackId,
                expectedIndex: null,
                replacementIndex: index,
            });
        }
    }

    const trackMemberships: RestoreLegacyVcaStatePayload['trackMemberships'][number][] = [];
    for (const trackId of validTrackIds) {
        const track = trackById.get(trackId);
        if (!track || (track.vcaGroupId ?? null) === groupId) {
            continue;
        }
        trackMemberships.push({
            trackId,
            expectedVcaGroupId: groupId,
            replacementVcaGroupId: track.vcaGroupId ?? null,
        });
    }

    return {
        groupRows: [
            {
                groupId,
                expected: {
                    group: {
                        id: groupId,
                        name: action.payload.name,
                        gain: 1,
                        muted: false,
                        trackIds: validTrackIds,
                    },
                    index: groups.length,
                },
                replacement: null,
            },
        ],
        groupGains: [],
        groupMemberships,
        trackMemberships,
    };
}

function captureAssignPatch(action: Extract<AppAction, { type: 'assignToVca' }>): RestoreLegacyVcaStatePayload {
    const groups = getVcaGroupsState();
    const targetGroup = groups.find((group) => group.id === action.payload.vcaGroupId);
    const track = getAllTracks().find((candidate) => candidate.id === action.payload.trackId);
    if (!targetGroup || !track) {
        return emptyPatch();
    }

    const groupMemberships: RestoreLegacyVcaStatePayload['groupMemberships'][number][] = [];
    for (const group of groups) {
        const replacementIndex = group.trackIds.indexOf(action.payload.trackId);
        let expectedIndex: number | null = null;
        if (group.id === targetGroup.id) {
            expectedIndex = group.trackIds.filter((trackId) => trackId !== action.payload.trackId).length;
        }
        const normalizedReplacementIndex = replacementIndex < 0 ? null : replacementIndex;
        if (expectedIndex === normalizedReplacementIndex) {
            continue;
        }
        groupMemberships.push({
            groupId: group.id,
            trackId: action.payload.trackId,
            expectedIndex,
            replacementIndex: normalizedReplacementIndex,
        });
    }

    const previousVcaGroupId = track.vcaGroupId ?? null;
    const trackMemberships: RestoreLegacyVcaStatePayload['trackMemberships'][number][] = [];
    if (previousVcaGroupId !== action.payload.vcaGroupId) {
        trackMemberships.push({
            trackId: track.id,
            expectedVcaGroupId: action.payload.vcaGroupId,
            replacementVcaGroupId: previousVcaGroupId,
        });
    }

    return {
        groupRows: [],
        groupGains: [],
        groupMemberships,
        trackMemberships,
    };
}

function captureRemovePatch(action: Extract<AppAction, { type: 'removeFromVca' }>): RestoreLegacyVcaStatePayload {
    const groups = getVcaGroupsState();
    const track = getAllTracks().find((candidate) => candidate.id === action.payload.trackId);
    const groupMemberships: RestoreLegacyVcaStatePayload['groupMemberships'][number][] = [];
    for (const group of groups) {
        const replacementIndex = group.trackIds.indexOf(action.payload.trackId);
        if (replacementIndex < 0) {
            continue;
        }
        groupMemberships.push({
            groupId: group.id,
            trackId: action.payload.trackId,
            expectedIndex: null,
            replacementIndex,
        });
    }

    const trackMemberships: RestoreLegacyVcaStatePayload['trackMemberships'][number][] = [];
    if (track && (track.vcaGroupId ?? null) !== null) {
        trackMemberships.push({
            trackId: track.id,
            expectedVcaGroupId: null,
            replacementVcaGroupId: track.vcaGroupId,
        });
    }

    return {
        groupRows: [],
        groupGains: [],
        groupMemberships,
        trackMemberships,
    };
}

function captureGainPatch(action: Extract<AppAction, { type: 'setVcaGain' }>): RestoreLegacyVcaStatePayload {
    const group = getVcaGroupsState().find((candidate) => candidate.id === action.payload.vcaGroupId);
    const expectedGain = Math.max(0, Math.min(2, action.payload.gain));
    if (!group || Object.is(group.gain, expectedGain)) {
        return emptyPatch();
    }

    return {
        groupRows: [],
        groupGains: [
            {
                groupId: group.id,
                expectedGain,
                replacementGain: group.gain,
            },
        ],
        groupMemberships: [],
        trackMemberships: [],
    };
}

function invertRestorePatch(payload: RestoreLegacyVcaStatePayload): RestoreLegacyVcaStatePayload {
    return {
        groupRows: payload.groupRows.map((patch) => ({
            ...patch,
            expected: patch.replacement,
            replacement: patch.expected,
        })),
        groupGains: payload.groupGains.map((patch) => ({
            ...patch,
            expectedGain: patch.replacementGain,
            replacementGain: patch.expectedGain,
        })),
        groupMemberships: payload.groupMemberships.map((patch) => ({
            ...patch,
            expectedIndex: patch.replacementIndex,
            replacementIndex: patch.expectedIndex,
        })),
        trackMemberships: payload.trackMemberships.map((patch) => ({
            ...patch,
            expectedVcaGroupId: patch.replacementVcaGroupId,
            replacementVcaGroupId: patch.expectedVcaGroupId,
        })),
    };
}

export function captureLegacyVcaState(action: LegacyVcaHistoryAction): RestoreLegacyVcaStatePayload {
    if (action.type === 'createVcaGroup') {
        return captureCreatePatch(action);
    }
    if (action.type === 'assignToVca') {
        return captureAssignPatch(action);
    }
    if (action.type === 'removeFromVca') {
        return captureRemovePatch(action);
    }
    if (action.type === 'setVcaGain') {
        return captureGainPatch(action);
    }
    return invertRestorePatch(action.payload);
}
