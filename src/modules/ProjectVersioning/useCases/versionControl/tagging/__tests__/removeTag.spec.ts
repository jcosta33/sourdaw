import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type VersionControlState } from '../../../../models/ProjectVersion';
import { makeVersion, makeVersionControlState } from '../../__tests__/versionControlTestFixtures';
import { removeTag } from '../removeTag';

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

describe('removeTag', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('does nothing without store state; else removes the tag only from the matching version', () => {
        removeTag('ver-1', 'drop');
        expect(mocks.storeSet).not.toHaveBeenCalled();
        mocks.storeValue.value = makeVersionControlState({
            versions: [
                makeVersion({ id: 'ver-1', tags: ['keep', 'drop'] }),
                makeVersion({ id: 'ver-2', tags: ['drop'] }),
            ],
        });
        removeTag('ver-1', 'drop');
        const next = mocks.storeSet.mock.calls[0]![0];
        expect(next.versions.find((v) => v.id === 'ver-1')?.tags).toEqual(['keep']);
        expect(next.versions.find((v) => v.id === 'ver-2')?.tags).toEqual(['drop']);
    });
});
