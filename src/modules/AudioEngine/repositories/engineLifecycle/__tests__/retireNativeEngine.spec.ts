import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import { retireNativeEngine } from '../retireNativeEngine';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    desktopInvoke: vi.fn(),
}));

describe('retireNativeEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    /**
     * The tokens are pinned against `RetireOutcome`'s kebab-case serialization
     * in `crates/sourdaw-native/src/commands/engine_lifecycle.rs`: both sides
     * are hand-maintained, so a rename on either one has to fail here.
     */
    it.each(['retired', 'no-engine', 'rendering'])('reads the %s outcome', async (outcome) => {
        vi.mocked(desktopInvoke).mockResolvedValue({ outcome, retiredInstanceIds: [] });

        await expect(retireNativeEngine()).resolves.toEqual({ outcome, retiredInstanceIds: [] });
    });

    it('parses the retired instance ids through', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({ outcome: 'retired', retiredInstanceIds: ['a', 'b'] });

        await expect(retireNativeEngine()).resolves.toEqual({
            outcome: 'retired',
            retiredInstanceIds: ['a', 'b'],
        });
    });

    it('invokes the command with no arguments', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({ outcome: 'retired', retiredInstanceIds: [] });

        await retireNativeEngine();

        expect(desktopInvoke).toHaveBeenCalledWith('retire_native_engine');
    });

    it('rejects an outcome this build does not know', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({ outcome: 'restarted', retiredInstanceIds: [] });

        await expect(retireNativeEngine()).rejects.toThrow('restarted');
    });

    it('rejects a payload carrying no outcome', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({});

        await expect(retireNativeEngine()).rejects.toThrow('unrecognized retire_native_engine outcome');
    });

    it('rejects a retiredInstanceIds list holding a non-string', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({ outcome: 'retired', retiredInstanceIds: ['a', 1] });

        await expect(retireNativeEngine()).rejects.toThrow('unrecognized retire_native_engine retiredInstanceIds');
    });

    it('reports no engine off the desktop without reaching the bridge', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        await expect(retireNativeEngine()).resolves.toEqual({ outcome: 'no-engine', retiredInstanceIds: [] });
        expect(desktopInvoke).not.toHaveBeenCalled();
    });
});
