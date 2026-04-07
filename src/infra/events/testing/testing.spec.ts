import { describe, it, expect } from 'vitest';
import { recordEvents } from './recordEvents';
import { createEventBus } from '../createEventBus';

type MyEvents = {
    'test:event': { id: number };
};

describe('Event Testing Helpers', () => {
    it('recordEvents() records emissions', async () => {
        const bus = createEventBus<MyEvents>();
        const { entries, stop } = recordEvents(bus);

        await bus.emit('test:event', { id: 1 });
        await bus.emit('test:event', { id: 2 });

        expect(entries).toEqual([
            { event: 'test:event', payload: { id: 1 } },
            { event: 'test:event', payload: { id: 2 } },
        ]);

        stop();
        await bus.emit('test:event', { id: 3 });
        
        expect(entries.length).toBe(2); // Should not record the third one
    });
});