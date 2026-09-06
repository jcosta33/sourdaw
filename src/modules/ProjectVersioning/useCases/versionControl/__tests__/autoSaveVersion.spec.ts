import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type VersionControlState } from '../../../models/ProjectVersion';
import { autoSaveVersion } from '../autoSaveVersion';

import { makeVersionControlState } from './versionControlTestFixtures';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as VersionControlState | null },
    createProjectVersion: vi.fn<(label: string, description?: string, tags?: string[]) => boolean>(),
}));

vi.mock('../../../stores/versionControlStore', () => ({
    versionControlStore: {
        get value() {
            return mocks.storeValue.value;
        },
    },
}));

vi.mock('../createProjectVersion', () => ({
    createProjectVersion: mocks.createProjectVersion,
}));

describe('autoSaveVersion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
        mocks.createProjectVersion.mockReturnValue(true);
    });

    it('skips without store state or a disabled interval, else creates a labeled auto-save checkpoint', () => {
        expect(autoSaveVersion()).toBe(false);
        mocks.storeValue.value = makeVersionControlState({ autoSaveInterval: 0 });
        expect(autoSaveVersion()).toBe(false);
        expect(mocks.createProjectVersion).not.toHaveBeenCalled();
        mocks.storeValue.value = makeVersionControlState({ autoSaveInterval: 5 });
        expect(autoSaveVersion()).toBe(true);
        const [label, description, tags] = mocks.createProjectVersion.mock.calls[0]!;
        expect(label).toMatch(/^Auto-save /);
        expect(description).toBe('Automatic checkpoint');
        expect(tags).toEqual(['auto-save']);
    });

    it('propagates capture refusal without changing the catalog itself', () => {
        const state = makeVersionControlState({ autoSaveInterval: 5 });
        mocks.storeValue.value = state;
        mocks.createProjectVersion.mockReturnValue(false);

        expect(autoSaveVersion()).toBe(false);
        expect(mocks.storeValue.value).toBe(state);
    });
});
