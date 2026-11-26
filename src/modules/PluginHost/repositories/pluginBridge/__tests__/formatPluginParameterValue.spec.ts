import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { formatPluginParameterValue } from '../formatPluginParameterValue';

vi.mock('#/utils/desktopBridge', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/utils/desktopBridge')>()),
    isDesktopRuntime: vi.fn(),
    desktopInvoke: vi.fn(),
}));

describe('formatPluginParameterValue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    it('asks the host under camelCase keys and returns its text', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue('1.20 kHz');

        await expect(formatPluginParameterValue('inst-1', 12, 0.43)).resolves.toBe('1.20 kHz');
        expect(desktopInvoke).toHaveBeenCalledWith('format_plugin_parameter_value', {
            instanceId: 'inst-1',
            paramId: 12,
            value: 0.43,
        });
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a number', 7],
        ['an object', { text: '1 kHz' }],
    ])('answers null when the host result is %s', async (_name, result) => {
        vi.mocked(desktopInvoke).mockResolvedValue(result);

        await expect(formatPluginParameterValue('inst-1', 12, 0.43)).resolves.toBeNull();
    });

    it('answers null without asking the host outside the desktop runtime', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        await expect(formatPluginParameterValue('inst-1', 12, 0.43)).resolves.toBeNull();
        expect(desktopInvoke).not.toHaveBeenCalled();
    });
});
