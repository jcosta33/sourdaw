import { describe, it, expect } from 'vitest';
import { createEventBus } from './createEventBus';

type MyEvents = {
    'test:event': { id: number };
    'other:event': { name: string };
};

describe('EventBus', () => {
    it('on() handler fires for matching event only', async () => {
        const bus = createEventBus<MyEvents>();
        let fired = 0;
        bus.on('test:event', (payload) => {
            fired++;
            expect(payload.id).toBe(1);
        });
        
        await bus.emit('test:event', { id: 1 });
        await bus.emit('other:event', { name: 'a' } as any); // cast for test
        
        expect(fired).toBe(1);
    });

    it('returned unsubscribe function removes handler', async () => {
        const bus = createEventBus<MyEvents>();
        let fired = 0;
        const unsub = bus.on('test:event', () => { fired++; });
        
        await bus.emit('test:event', { id: 1 });
        unsub();
        await bus.emit('test:event', { id: 1 });
        
        expect(fired).toBe(1);
    });

    it('once() fires exactly once', async () => {
        const bus = createEventBus<MyEvents>();
        let fired = 0;
        bus.once('test:event', () => { fired++; });
        
        await bus.emit('test:event', { id: 1 });
        await bus.emit('test:event', { id: 1 });
        
        expect(fired).toBe(1);
    });

    it('onAny() receives event name and payload', async () => {
        const bus = createEventBus<MyEvents>();
        let lastEvent: string = '';
        let lastPayload: any = null;
        
        bus.onAny((ev, payload) => {
            lastEvent = ev;
            lastPayload = payload;
        });
        
        await bus.emit('test:event', { id: 42 });
        
        expect(lastEvent).toBe('test:event');
        expect(lastPayload).toEqual({ id: 42 });
    });

    it('emit() awaits async handlers', async () => {
        const bus = createEventBus<MyEvents>();
        let asyncFinished = false;
        
        bus.on('test:event', async () => {
            await new Promise(r => setTimeout(r, 10));
            asyncFinished = true;
        });
        
        await bus.emit('test:event', { id: 1 });
        expect(asyncFinished).toBe(true);
    });

    it('waitForIdle() resolves after pending handlers finish', async () => {
        const bus = createEventBus<MyEvents>();
        let asyncFinished = false;
        
        bus.on('test:event', async () => {
            await new Promise(r => setTimeout(r, 20));
            asyncFinished = true;
        });
        
        // Don't await emit directly
        const p = bus.emit('test:event', { id: 1 });
        
        expect(asyncFinished).toBe(false);
        expect(bus.pendingCount).toBe(1);
        expect(bus.isIdle).toBe(false);
        
        await bus.waitForIdle();
        
        expect(asyncFinished).toBe(true);
        expect(bus.pendingCount).toBe(0);
        expect(bus.isIdle).toBe(true);
        
        await p;
    });

    it('unsubscribe during emit does not corrupt iteration', async () => {
        const bus = createEventBus<MyEvents>();
        let fired2 = false;
        
        const unsub1 = bus.on('test:event', () => {
            unsub1();
            unsub2(); // Unsubscribe the next handler before it runs
        });
        
        const unsub2 = bus.on('test:event', () => {
            fired2 = true;
        });
        
        await bus.emit('test:event', { id: 1 });
        
        // Iteration copies the set, so fired2 should be true for this emission
        expect(fired2).toBe(true);
        
        // But subsequent emissions should not fire
        fired2 = false;
        await bus.emit('test:event', { id: 2 });
        expect(fired2).toBe(false);
    });
});