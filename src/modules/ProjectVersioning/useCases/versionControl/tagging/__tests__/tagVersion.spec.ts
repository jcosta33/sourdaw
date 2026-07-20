import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type VersionControlState } from '../../../../models/ProjectVersion';
import { makeVersion, makeVersionControlState } from '../../__tests__/versionControlTestFixtures';
import { tagVersion } from '../tagVersion';

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

describe('tagVersion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('does nothing without store state; else appends the tag only to the matching version', () => {
        tagVersion('ver-1', 'release');
        expect(mocks.storeSet).not.toHaveBeenCalled();
        mocks.storeValue.value = makeVersionControlState({
            versions: [makeVersion({ id: 'ver-1', tags: ['existing'] }), makeVersion({ id: 'ver-2', tags: [] })],
        });
        tagVersion('ver-1', 'release');
        const next = mocks.storeSet.mock.calls[0]![0];
        expect(next.versions.find((v) => v.id === 'ver-1')?.tags).toEqual(['existing', 'release']);
        expect(next.versions.find((v) => v.id === 'ver-2')?.tags).toEqual([]);
    });
});
