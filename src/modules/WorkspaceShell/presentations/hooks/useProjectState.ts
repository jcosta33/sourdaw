/**
 * useProjectState — subscribe to the canonical projectStore.
 *
 * §12.2 — previously redeclared a local ProjectViewState type that had
 * to be kept in sync by hand. Use the canonical \`ProjectStoreState\`
 * re-exported from \`#/modules/Project\` so any store-side shape change
 * reaches this consumer automatically.
 */
import { useStore } from '#/infra/store/useStore';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import type { ProjectStoreState } from '#/modules/Project/stores';

const defaultState: ProjectStoreState = structuredClone(defaultProjectStoreState);

export const useProjectState = (): ProjectStoreState => {
    return useStore(projectStore, defaultState);
};
