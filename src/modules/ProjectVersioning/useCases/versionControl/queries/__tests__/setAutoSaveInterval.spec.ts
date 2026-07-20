import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type VersionControlState } from '../../../../models/ProjectVersion';
import { makeVersionControlState } from '../../__tests__/versionControlTestFixtures';
import { setAutoSaveInterval } from '../setAutoSaveInterval';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as VersionControlState | null },
    storeSet: vi.fn<(value: VersionControlState) => void>(),
}));

vi.mock('../../../../stores/versionControlStore', () => ({
    versionControlStore: {
        get value() {
            return mocks.storeValue.value;
        },
        set: mocks.storeSet,
    },
}));

describe('setAutoSaveInterval', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('does nothing without store state; else updates the interval while preserving the rest', () => {
        setAutoSaveInterval(10);
        expect(mocks.storeSet).not.toHaveBeenCalled();
        mocks.storeValue.value = makeVersionControlState();
        setAutoSaveInterval(15);
        expect(mocks.storeSet).toHaveBeenCalledWith(makeVersionControlState({ autoSaveInterval: 15 }));
    });
});
