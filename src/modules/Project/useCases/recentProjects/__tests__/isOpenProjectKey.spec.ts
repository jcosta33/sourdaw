import { afterEach, describe, expect, it } from 'vitest';

import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { getProjectSnapshotKey } from '../../projectPersistence/getProjectSnapshotKey';
import { isOpenProjectKey } from '../isOpenProjectKey';

describe('isOpenProjectKey', () => {
    afterEach(() => {
        projectStore.set(structuredClone(defaultProjectStoreState));
    });

    it('names the open project by its created-at snapshot key', () => {
        projectStore.set({ ...structuredClone(defaultProjectStoreState), createdAt: 1_700_000_000_000 });

        expect(isOpenProjectKey(getProjectSnapshotKey(1_700_000_000_000))).toBe(true);
    });

    it('rejects a different project, which still opens', () => {
        projectStore.set({ ...structuredClone(defaultProjectStoreState), createdAt: 1_700_000_000_000 });

        expect(isOpenProjectKey(getProjectSnapshotKey(1_700_000_000_001))).toBe(false);
    });

    it('rejects every key while no project is open', () => {
        projectStore.set(null);

        expect(isOpenProjectKey(getProjectSnapshotKey(0))).toBe(false);
    });
});
