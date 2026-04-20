/**
 * useProjectState — subscribe to the canonical projectStore.
 *
 * §12.2 — previously redeclared a local ProjectViewState type that had
 * to be kept in sync by hand. Use the canonical \`ProjectStoreState\`
 * re-exported from \`#/modules/Project\` so any store-side shape change
 * reaches this consumer automatically.
 */
import { useStore } from '#/infra/store/useStore';
import { projectStore } from '#/modules/Project/stores';
import type { ProjectStoreState } from '#/modules/Project/stores';

const defaultState: ProjectStoreState = {
    name: 'Untitled Project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dirty: false,
    loading: true,
    keyRoot: 0,
    scaleName: 'chromatic',
    tuning: {
        name: 'Equal Temperament',
        frequencies: Array.from({ length: 128 }, (_, i) => 440 * Math.pow(2, (i - 69) / 12)),
    },
    initialized: false,
};

export const useProjectState = (): ProjectStoreState => {
    return useStore(projectStore, defaultState);
};
