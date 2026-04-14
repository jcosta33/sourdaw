import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getVersionHistory } from '../getVersionHistory';
import { type VersionControlState } from '../../../../models/ProjectVersion';

const mockStore = vi.hoisted(() => ({
    value: null as VersionControlState | null,
}));

vi.mock('../../../../stores/versionControlStore', () => ({
    versionControlStore: {
        get value() {
            return mockStore.value;
        },
    },
}));

describe('getVersionHistory', () => {
    beforeEach(() => {
        mockStore.value = null;
    });

    it('should return null when the store is empty', () => {
        expect(getVersionHistory()).toBeNull();
    });

    it('should return the current version control snapshot', () => {
        const snapshot = {
            versions: [],
            branches: [],
            currentBranchId: 'main',
            currentVersionId: null,
            autoSaveInterval: 0,
        } as VersionControlState;
        mockStore.value = snapshot;

        expect(getVersionHistory()).toBe(snapshot);
    });
});
