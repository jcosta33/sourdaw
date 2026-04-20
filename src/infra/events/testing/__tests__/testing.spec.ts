import { describe, it, expect } from 'vitest';

import { createEventBus } from '../../createEventBus';
import { recordEvents } from '../recordEvents';

type MyEvents = {
    'test:event': { id: number };
};

describe('Event Testing Helpers', () => {
    it('should record emissions and stop recording', async () => {
        const bus = createEventBus<MyEvents>();
        const recorder = recordEvents(bus);

        await bus.emit('test:event', { id: 1 });
        await bus.emit('test:event', { id: 2 });

        expect(recorder.entries).toEqual([
            { event: 'test:event', payload: { id: 1 } },
            { event: 'test:event', payload: { id: 2 } },
        ]);

        recorder.stop();
        await bus.emit('test:event', { id: 3 });

        expect(recorder.entries.length).toBe(2);
    });
});
