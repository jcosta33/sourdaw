/**
 * VCA group store.
 *
 * §202.1 — prior to this file using \`createStore\`, the VCA groups lived
 * in a bare module-level \`let\` array, so inspector components reading
 * \`getVcaGroupsState()\` during render had no reactive subscription —
 * creating or renaming a VCA group left the dropdown options stale. The
 * store is now HMR-safe as well (§14.1 pattern).
 */

import { createStore } from '#/infra/store/createStore';
import { type Store } from '#/infra/store/types';

export type VcaGroup = {
    id: string;
    name: string;
    gain: number;
    muted: boolean;
    trackIds: string[];
};

export type VcaGroupState = { groups: VcaGroup[] };

export const defaultVcaGroupState: VcaGroupState = { groups: [] };

export const vcaGroupStore: Store<VcaGroupState> = createStore<VcaGroupState>({
    initialData: defaultVcaGroupState,
});

export function getVcaGroupsState(): VcaGroup[] {
    return vcaGroupStore.value?.groups ?? [];
}

export function setVcaGroupsState(groups: VcaGroup[]): void {
    vcaGroupStore.set({ groups });
}

function isVcaGroup(value: unknown): value is VcaGroup {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) {
        return false;
    }
    if (!('name' in value) || typeof value.name !== 'string') {
        return false;
    }
    if (!('muted' in value) || typeof value.muted !== 'boolean') {
        return false;
    }
    if (!('gain' in value) || typeof value.gain !== 'number' || !Number.isFinite(value.gain)) {
        return false;
    }
    if (!('trackIds' in value) || !Array.isArray(value.trackIds)) {
        return false;
    }
    return value.trackIds.every((trackId) => typeof trackId === 'string');
}

/**
 * Decode persisted VCA groups from a project file.
 *
 * A group that does not decode is dropped rather than repaired: a member track
 * whose group vanished falls back to a multiplier of `1` in
 * {@link deriveVcaMultiplier}, which is the same unity fallback the loader
 * would otherwise reach by a slower route. Duplicated ids keep the first
 * occurrence, because `deriveVcaMultiplier` resolves by `find` and would
 * silently ignore the rest anyway.
 */
export function sanitizeVcaGroups(value: unknown): VcaGroup[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const groups: VcaGroup[] = [];
    const seenIds = new Set<string>();
    for (const candidate of value) {
        if (!isVcaGroup(candidate) || seenIds.has(candidate.id)) {
            continue;
        }
        seenIds.add(candidate.id);
        groups.push({
            id: candidate.id,
            name: candidate.name,
            gain: candidate.gain,
            muted: candidate.muted,
            trackIds: [...candidate.trackIds],
        });
    }
    return groups;
}

export type DeriveVcaMultiplierInput = {
    /** The track's `vcaGroupId`; `null`/`undefined` means it belongs to no group. */
    vcaGroupId: string | null | undefined;
    groups: readonly VcaGroup[];
};

/**
 * The plain gain multiplier a track's VCA group master contributes, or `1` when
 * the track is in no group (or names a group that no longer exists).
 *
 * Kept as a pure derivation over explicit inputs rather than a store read so
 * both runtimes can share it: live resolves it through `getEffectiveGain`, and
 * the offline render — which cannot import Arrangement's use cases without
 * closing an import cycle — reads the group list and calls this directly. One
 * implementation, so a bounce cannot drift from what the mixer plays.
 */
export function deriveVcaMultiplier({ vcaGroupId, groups }: DeriveVcaMultiplierInput): number {
    if (!vcaGroupId) {
        return 1;
    }

    const group = groups.find((candidate) => candidate.id === vcaGroupId);
    if (!group) {
        return 1;
    }

    return group.gain;
}
