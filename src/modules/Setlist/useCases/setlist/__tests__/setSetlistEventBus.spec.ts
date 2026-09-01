import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { MidiOutPayload } from '#/modules/WorkspaceShell/events';

import { SetlistEventBus } from '../setlistEventBus';

vi.mock('../advanceSetlistItemEnd', () => ({
    advanceSetlistItemEnd: vi.fn(),
}));

class TestSetlistEventBus extends SetlistEventBus {
    readonly emitMock = vi
        .fn<(event: 'midi.out', payload: MidiOutPayload) => Promise<void>>()
        .mockResolvedValue(undefined);

    emit(event: 'midi.out', payload: MidiOutPayload): Promise<void> {
        return this.emitMock(event, payload);
    }
}

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
        const eventBus = new TestSetlistEventBus();

        setSetlistEventBus(eventBus);

        expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
        expect(Container.get(SetlistEventBus)).toBe(eventBus);
    });
});
