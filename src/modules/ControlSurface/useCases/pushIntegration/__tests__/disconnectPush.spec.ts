import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pushHardwareTransport } from '../../../repositories/pushHardwareTransport';
import { pushStore } from '../../../stores/push';
import { disconnectPush } from '../disconnectPush';

vi.mock('../../../repositories/pushHardwareTransport', () => ({
    pushHardwareTransport: {
        disconnect: vi.fn(),
    },
}));

describe('disconnectPush', () => {
    beforeEach(() => {
        vi.mocked(pushHardwareTransport.disconnect).mockReset().mockResolvedValue();
        pushStore.set({
            ...pushStore.value!,
            connected: true,
            model: 'push2',
        });
    });

    it('clears connection only after the hardware transport closes', async () => {
        let finishDisconnect: (() => void) | undefined;
        vi.mocked(pushHardwareTransport.disconnect).mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishDisconnect = resolve;
                })
        );

        const disconnection = disconnectPush();
        expect(pushStore.value?.connected).toBe(true);

        finishDisconnect?.();
        await disconnection;

        expect(pushStore.value?.connected).toBe(false);
        expect(pushStore.value?.model).toBeNull();
    });

    it('preserves connected state when transport cleanup rejects', async () => {
        vi.mocked(pushHardwareTransport.disconnect).mockRejectedValue(new Error('close failed'));

        await expect(disconnectPush()).rejects.toThrow('close failed');
        expect(pushStore.value?.connected).toBe(true);
        expect(pushStore.value?.model).toBe('push2');
    });

    it('should not mutate when push store is null', async () => {
        pushStore.set(null);
        await disconnectPush();
        expect(pushStore.value).toBeNull();
    });
});
