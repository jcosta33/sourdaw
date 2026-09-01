import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';

vi.mock('../advanceSetlistItemEnd', () => ({
    advanceSetlistItemEnd: vi.fn(),
}));

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

describe('setSetlistEventBus', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
    });

    beforeEach(() => {
        vi.resetModules();
        rafCallbacks.length = 0;
        requestAnimationFrameMock.mockClear();
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('starts the item-end observer when registering the event bus', async () => {
        const [{ Container }, { setSetlistEventBus }, { SetlistEventBus }] = await Promise.all([
            import('#/infra/di/Container'),
            import('../setSetlistEventBus'),
            import('../setlistEventBus'),
        ]);
        Container.clear();
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);

        setSetlistEventBus(eventBus as unknown as InstanceType<typeof SetlistEventBus>);

        expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
        expect(Container.get(SetlistEventBus)).toBe(eventBus);
    });
});
