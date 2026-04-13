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
