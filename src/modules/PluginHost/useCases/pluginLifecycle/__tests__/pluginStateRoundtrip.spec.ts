import { describe, it, expect, vi, beforeEach } from 'vitest';

import { readPluginState } from '../readPluginState';
import { restorePluginState } from '../restorePluginState';

const mocks = vi.hoisted(() => ({
    getPluginState: vi.fn<(instanceId: string) => Promise<Uint8Array>>(),
    setPluginState: vi.fn<(instanceId: string, state: Uint8Array) => Promise<void>>(),
}));

vi.mock('../../../repositories/pluginBridge/getPluginState', () => ({ getPluginState: mocks.getPluginState }));
vi.mock('../../../repositories/pluginBridge/setPluginState', () => ({ setPluginState: mocks.setPluginState }));

function base64Of(bytes: number[]): string {
    return btoa(String.fromCharCode(...bytes));
}

describe('native plugin state round-trip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setPluginState.mockResolvedValue(undefined);
    });

    it('reads a byte chunk as base64', async () => {
        mocks.getPluginState.mockResolvedValue(new Uint8Array([1, 2, 3, 255]));

        expect(await readPluginState('inst-1')).toBe(base64Of([1, 2, 3, 255]));
    });

    it('returns empty string for an empty chunk (absent plugin / dev mode)', async () => {
        mocks.getPluginState.mockResolvedValue(new Uint8Array());

        expect(await readPluginState('inst-1')).toBe('');
    });

    it('restores base64 back to the exact bytes', async () => {
        await restorePluginState('inst-1', base64Of([1, 2, 3, 255]));

        expect(mocks.setPluginState).toHaveBeenCalledWith('inst-1', new Uint8Array([1, 2, 3, 255]));
    });

    it('round-trips read -> restore preserving every byte, including 0 and high values', async () => {
        const original = [10, 20, 30, 200, 0, 128, 255];
        mocks.getPluginState.mockResolvedValue(new Uint8Array(original));

        const chunk = await readPluginState('inst-1');
        await restorePluginState('inst-1', chunk);

        expect(mocks.setPluginState).toHaveBeenCalledWith('inst-1', new Uint8Array(original));
    });

    it('round-trips every one of the 256 byte values without loss', async () => {
        const original = Array.from({ length: 256 }, (_value, index) => index);
        mocks.getPluginState.mockResolvedValue(new Uint8Array(original));

        const chunk = await readPluginState('inst-1');
        await restorePluginState('inst-1', chunk);

        expect(mocks.setPluginState).toHaveBeenCalledWith('inst-1', new Uint8Array(original));
    });

    it('does not call the bridge for a blank restore', async () => {
        await restorePluginState('inst-1', '');

        expect(mocks.setPluginState).not.toHaveBeenCalled();
    });
});
