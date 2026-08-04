/**
 * Conditional inverse patch for the four legacy VCA actions.
 *
 * **This survives `vcaGroupStore` becoming CRDT-backed, and it is not the
 * leftover it looks like.** Nothing in this application undoes through
 * Automerge: `executeAppAction` records the `inverseAction` its handler's
 * `describe()` returns, and `undo()` replays that action forward. Every
 * slot-backed store does the same — `handleSetAutomationLaneEnabled` sits on
 * the `automation` slot and still emits its own explicit inverse. The document
 * transaction is the atomic commit boundary for a write, not an undo log.
 *
 * What the expected/replacement pairs buy is the part a plain inverse cannot
 * do: `revertAction` can revert a *non-latest* entry, so the inverse has to
 * check that the fields it is about to overwrite still hold the values it was
 * captured against, and report `conflict` instead of clobbering a later edit.
 * See `handlers/vca/__tests__/legacyVcaActionHistory.spec.ts`.
 */
import { type AppAction } from '#/utils/handlerContract';

import { getVcaGroupsState, setVcaGroupsState, type VcaGroup } from '../../stores/vcaGroupStore';
import { getTrackStoreState } from '../getTrackStoreState';
import { setTrackStoreState } from '../setTrackStoreState';

type RestoreLegacyVcaStateAction = Extract<AppAction, { type: 'restoreLegacyVcaState' }>;
type RestoreLegacyVcaStatePayload = RestoreLegacyVcaStateAction['payload'];
type RestoreLegacyVcaStateResult = 'written' | 'no-write' | 'conflict';

function cloneGroup(group: VcaGroup): VcaGroup {
    return { ...group, trackIds: [...group.trackIds] };
}

function groupsEqual(left: VcaGroup, right: RestoreLegacyVcaStatePayload['groupRows'][number]['expected']): boolean {
    if (!right) {
        return false;
    }
    const expected = right.group;
    return (
        left.id === expected.id &&
        left.name === expected.name &&
        Object.is(left.gain, expected.gain) &&
        left.muted === expected.muted &&
        left.trackIds.length === expected.trackIds.length &&
        left.trackIds.every((trackId, index) => trackId === expected.trackIds[index])
    );
}

function getOccurrenceIndices(trackIds: readonly string[], targetTrackId: string): number[] {
    const indices: number[] = [];
    for (const [index, trackId] of trackIds.entries()) {
        if (trackId === targetTrackId) {
            indices.push(index);
        }
    }
    return indices;
}

function occurrenceIndicesEqual(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length && left.every((index, position) => index === right[position]);
}

function expectedStateMatches(payload: RestoreLegacyVcaStatePayload): boolean {
    const groups = getVcaGroupsState();
    const trackState = getTrackStoreState();

    for (const patch of payload.groupRows) {
        const currentIndex = groups.findIndex((group) => group.id === patch.groupId);
        if (!patch.expected) {
            if (currentIndex >= 0) {
                return false;
            }
            continue;
        }
        if (currentIndex !== patch.expected.index) {
            return false;
        }
        const currentGroup = groups[currentIndex];
        if (!currentGroup || !groupsEqual(currentGroup, patch.expected)) {
            return false;
        }
    }

    for (const patch of payload.groupGains) {
        const group = groups.find((candidate) => candidate.id === patch.groupId);
        if (!group || !Object.is(group.gain, patch.expectedGain)) {
            return false;
        }
    }

    for (const patch of payload.groupMemberships) {
        const group = groups.find((candidate) => candidate.id === patch.groupId);
        if (!group) {
            return false;
        }
        const currentIndices = getOccurrenceIndices(group.trackIds, patch.trackId);
        if (!occurrenceIndicesEqual(currentIndices, patch.expectedIndices)) {
            return false;
        }
    }

    for (const patch of payload.trackMemberships) {
        const track = trackState?.tracks.find((candidate) => candidate.id === patch.trackId);
        if (!track || (track.vcaGroupId ?? null) !== patch.expectedVcaGroupId) {
            return false;
        }
    }

    return true;
}

function applyGroupRowPatches(groups: VcaGroup[], payload: RestoreLegacyVcaStatePayload): VcaGroup[] {
    let nextGroups = groups.map(cloneGroup);
    for (const patch of payload.groupRows) {
        nextGroups = nextGroups.filter((group) => group.id !== patch.groupId);
        if (!patch.replacement) {
            continue;
        }
        const insertionIndex = Math.max(0, Math.min(patch.replacement.index, nextGroups.length));
        nextGroups.splice(insertionIndex, 0, {
            ...patch.replacement.group,
            trackIds: [...patch.replacement.group.trackIds],
        });
    }
    return nextGroups;
}

function applyGroupGainPatches(groups: VcaGroup[], payload: RestoreLegacyVcaStatePayload): VcaGroup[] {
    return groups.map((group) => {
        const patch = payload.groupGains.find((candidate) => candidate.groupId === group.id);
        if (!patch) {
            return group;
        }
        return { ...group, gain: patch.replacementGain };
    });
}

function applyGroupMembershipPatches(groups: VcaGroup[], payload: RestoreLegacyVcaStatePayload): VcaGroup[] | null {
    const nextGroups: VcaGroup[] = [];
    for (const group of groups) {
        const patches = payload.groupMemberships.filter((patch) => patch.groupId === group.id);
        if (patches.length === 0) {
            nextGroups.push(group);
            continue;
        }

        const patchedTrackIds = new Set(patches.map((patch) => patch.trackId));
        const trackIds = group.trackIds.filter((trackId) => !patchedTrackIds.has(trackId));
        const insertions = patches
            .flatMap((patch) => patch.replacementIndices.map((index) => ({ index, trackId: patch.trackId })))
            .toSorted((left, right) => left.index - right.index);
        const occupiedIndices = new Set<number>();
        for (const insertion of insertions) {
            if (
                !Number.isInteger(insertion.index) ||
                insertion.index < 0 ||
                insertion.index > trackIds.length ||
                occupiedIndices.has(insertion.index)
            ) {
                return null;
            }
            occupiedIndices.add(insertion.index);
            trackIds.splice(insertion.index, 0, insertion.trackId);
        }

        const replacementIsExact = patches.every((patch) =>
            occurrenceIndicesEqual(getOccurrenceIndices(trackIds, patch.trackId), patch.replacementIndices)
        );
        if (!replacementIsExact) {
            return null;
        }
        nextGroups.push({ ...group, trackIds });
    }
    return nextGroups;
}

export function restoreLegacyVcaState(payload: RestoreLegacyVcaStatePayload): RestoreLegacyVcaStateResult {
    const hasPatches =
        payload.groupRows.length > 0 ||
        payload.groupGains.length > 0 ||
        payload.groupMemberships.length > 0 ||
        payload.trackMemberships.length > 0;
    if (!hasPatches) {
        return 'no-write';
    }
    if (!expectedStateMatches(payload)) {
        return 'conflict';
    }

    if (payload.groupRows.length > 0 || payload.groupGains.length > 0 || payload.groupMemberships.length > 0) {
        let groups = applyGroupRowPatches(getVcaGroupsState(), payload);
        groups = applyGroupGainPatches(groups, payload);
        const groupsWithMemberships = applyGroupMembershipPatches(groups, payload);
        if (!groupsWithMemberships) {
            return 'conflict';
        }
        groups = groupsWithMemberships;
        setVcaGroupsState(groups);
    }

    if (payload.trackMemberships.length > 0) {
        const trackState = getTrackStoreState();
        if (!trackState) {
            return 'conflict';
        }
        const replacementByTrackId = new Map(
            payload.trackMemberships.map((patch) => [patch.trackId, patch.replacementVcaGroupId])
        );
        setTrackStoreState({
            ...trackState,
            tracks: trackState.tracks.map((track) => {
                if (!replacementByTrackId.has(track.id)) {
                    return track;
                }
                return { ...track, vcaGroupId: replacementByTrackId.get(track.id) ?? null };
            }),
        });
    }

    return 'written';
}
