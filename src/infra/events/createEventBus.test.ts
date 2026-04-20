import { describe, it, expect, vi } from 'vitest';

import { createEventBus } from './createEventBus';
import { recordEvents } from './testing/recordEvents';

type TestEvents = {
    'user.created': { id: string; name: string };
    'user.updated': { id: string; name: string };
};

describe('createEventBus', () => {
    it('on() handler fires for matching event only', async () => {
        const bus = createEventBus<TestEvents>();
        const handler = vi.fn();
        const otherHandler = vi.fn();

        bus.on('user.created', handler);
        bus.on('user.updated', otherHandler);

        await bus.emit('user.created', { id: '1', name: 'Alice' });

        expect(handler).toHaveBeenCalledWith({ id: '1', name: 'Alice' });
        expect(otherHandler).not.toHaveBeenCalled();
    });

    it('returned unsubscribe function removes handler', async () => {
        const bus = createEventBus<TestEvents>();
        const handler = vi.fn();

        const unsubscribe = bus.on('user.created', handler);
        unsubscribe();

        await bus.emit('user.created', { id: '1', name: 'Alice' });

        expect(handler).not.toHaveBeenCalled();
    });

    it('once() fires exactly once then auto-unsubscribes', async () => {
        const bus = createEventBus<TestEvents>();
        const handler = vi.fn();

        bus.once('user.created', handler);

        await bus.emit('user.created', { id: '1', name: 'Alice' });
        await bus.emit('user.created', { id: '2', name: 'Bob' });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ id: '1', name: 'Alice' });
    });

    it('onAny() receives event name and payload', async () => {
        const bus = createEventBus<TestEvents>();
        const handler = vi.fn();

        bus.onAny(handler);

        await bus.emit('user.created', { id: '1', name: 'Alice' });

        expect(handler).toHaveBeenCalledWith('user.created', { id: '1', name: 'Alice' });
    });

    it('emit() awaits async handlers', async () => {
        const bus = createEventBus<TestEvents>();
        let completed = false;

        bus.on('user.created', async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            completed = true;
        });

        await bus.emit('user.created', { id: '1', name: 'Alice' });

        expect(completed).toBe(true);
    });

    it('waitForIdle() resolves after pending handlers finish', async () => {
        const bus = createEventBus<TestEvents>();
        let completed = false;

        bus.on('user.created', async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            completed = true;
        });

        const emitPromise = bus.emit('user.created', { id: '1', name: 'Alice' });

        expect(bus.isIdle).toBe(false);
        expect(bus.pendingCount).toBe(1);

        await bus.waitForIdle();

        expect(completed).toBe(true);
        expect(bus.isIdle).toBe(true);
        expect(bus.pendingCount).toBe(0);
        await emitPromise;
    });

    it('waitForIdle() resolves immediately if idle', async () => {
        const bus = createEventBus<TestEvents>();
        await bus.waitForIdle();
        expect(bus.isIdle).toBe(true);
    });

    it('unsubscribe during emit does not corrupt iteration', async () => {
        const bus = createEventBus<TestEvents>();
        const handler2 = vi.fn();

        const unsub1 = bus.on('user.created', () => {
            unsub1();
        });
        bus.on('user.created', handler2);

        await bus.emit('user.created', { id: '1', name: 'Alice' });

        expect(handler2).toHaveBeenCalledTimes(1);
    });
});

describe('recordEvents', () => {
    it('records emissions', async () => {
        const bus = createEventBus<TestEvents>();
        const recorder = recordEvents(bus);

        await bus.emit('user.created', { id: '1', name: 'Alice' });

        expect(recorder.entries.length).toBe(1);
        expect(recorder.entries[0]).toEqual({
            event: 'user.created',
            payload: { id: '1', name: 'Alice' },
        });

        recorder.stop();
        await bus.emit('user.updated', { id: '1', name: 'Alice2' });
        expect(recorder.entries.length).toBe(1);
    });
});
