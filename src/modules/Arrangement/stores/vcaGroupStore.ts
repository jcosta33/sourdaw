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
