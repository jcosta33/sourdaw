import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { readPluginTails } from '../readPluginTails';

vi.mock('#/utils/desktopBridge', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/utils/desktopBridge')>()),
    isDesktopRuntime: vi.fn(),
    desktopInvoke: vi.fn(),
}));

describe('readPluginTails', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    it('invokes read_plugin_tails with the instance ids under the camelCase key the seam maps to the addon', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue([]);

        await readPluginTails(['inst-1', 'inst-2']);

        expect(desktopInvoke).toHaveBeenCalledTimes(1);
        expect(desktopInvoke).toHaveBeenCalledWith('read_plugin_tails', { instanceIds: ['inst-1', 'inst-2'] });
    });

    it('passes valid readings through, in the order the host answered', async () => {
        const readings = [
            { instance_id: 'inst-2', tail_samples: 240_000 },
            { instance_id: 'inst-1', tail_samples: 0 },
        ];
        vi.mocked(desktopInvoke).mockResolvedValue(readings);

        await expect(readPluginTails(['inst-1', 'inst-2'])).resolves.toEqual(readings);
    });

    it.each([
        ['an instance id that is not a string', { instance_id: 7, tail_samples: 100 }],
        ['a tail that is not a number', { instance_id: 'bad', tail_samples: '100' }],
        ['a negative tail', { instance_id: 'bad', tail_samples: -1 }],
        ['a fractional tail', { instance_id: 'bad', tail_samples: 1.5 }],
        ['a missing tail', { instance_id: 'bad' }],
        ['null', null],
        ['a bare string', 'inst-1'],
    ])('drops %s and keeps the valid reading beside it', async (_name, malformed) => {
        const valid = { instance_id: 'inst-1', tail_samples: 48_000 };
        vi.mocked(desktopInvoke).mockResolvedValue([malformed, valid]);

        await expect(readPluginTails(['inst-1'])).resolves.toEqual([valid]);
    });

    it.each([
        ['an object', { instance_id: 'inst-1', tail_samples: 1 }],
        ['null', null],
        ['undefined', undefined],
    ])('rejects when the host answers %s instead of a list', async (_name, answer) => {
        vi.mocked(desktopInvoke).mockResolvedValue(answer);

        await expect(readPluginTails(['inst-1'])).rejects.toThrow(TypeError);
    });

    it('answers an empty list in a browser runtime without invoking the host', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        await expect(readPluginTails(['inst-1'])).resolves.toEqual([]);
        expect(desktopInvoke).not.toHaveBeenCalled();
    });
});
