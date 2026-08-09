import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    shortcutStore: {
        value: null as { definitions: unknown[]; customMappings: Record<string, unknown> } | null,
        trySet: vi.fn(),
    },
}));

vi.mock('../../stores/shortcutStore', () => ({
    shortcutStore: mocks.shortcutStore,
}));

import { resetShortcutMappings } from '../resetShortcutMappings';

describe('resetShortcutMappings', () => {
    it('clears customMappings while preserving definitions', () => {
        const definitions = [{ id: 'def-1', action: 'play' }];
        mocks.shortcutStore.value = { definitions, customMappings: { 'Cmd+K': 'custom-action' } };
        mocks.shortcutStore.trySet.mockClear();

        resetShortcutMappings();

        expect(mocks.shortcutStore.trySet).toHaveBeenCalledTimes(1);
        const [newState] = mocks.shortcutStore.trySet.mock.calls[0]!;
        // Definitions preserved exactly.
        expect(newState.definitions).toBe(definitions);
        // Custom mappings cleared.
        expect(newState.customMappings).toEqual({});
    });

    it('is a no-op when the store is null (not yet hydrated)', () => {
        mocks.shortcutStore.value = null;
        mocks.shortcutStore.trySet.mockClear();

        resetShortcutMappings();

        expect(mocks.shortcutStore.trySet).not.toHaveBeenCalled();
    });

    it('clears even when customMappings is already empty', () => {
        mocks.shortcutStore.value = { definitions: [], customMappings: {} };
        mocks.shortcutStore.trySet.mockClear();

        resetShortcutMappings();

        expect(mocks.shortcutStore.trySet).toHaveBeenCalledWith({
            definitions: [],
            customMappings: {},
        });
    });
});
