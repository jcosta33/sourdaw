import { describe, expect, it, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { cancelNativeGraphOfflineRender } from '../cancelNativeGraphOfflineRender';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn(),
}));

describe('cancelNativeGraphOfflineRender', () => {
    it('cancels a render by its id through cancel_graph_offline', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue(undefined);

        await cancelNativeGraphOfflineRender('bounce-7');

        expect(desktopInvoke).toHaveBeenCalledWith('cancel_graph_offline', { renderId: 'bounce-7' });
    });
});
