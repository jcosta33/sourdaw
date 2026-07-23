import { describe, it, expect } from 'vitest';

import { getControlRoomHandlers } from '../getControlRoomHandlers';

describe('getControlRoomHandlers', () => {
    it('exposes the three live control-room handlers', () => {
        const map = getControlRoomHandlers();
        const keys = Object.keys(map).sort();
        expect(keys).toEqual(['switchMonitor', 'toggleControlRoomDim', 'toggleControlRoomMono']);
    });

    it('returns a fresh map per call (no shared reference)', () => {
        const first = getControlRoomHandlers();
        const second = getControlRoomHandlers();
        expect(first).not.toBe(second);
        expect(first.switchMonitor).toBe(second.switchMonitor);
    });

    it('every handler is a complete ActionHandler (execute + describe + undoable)', () => {
        const map = getControlRoomHandlers();
        for (const handler of Object.values(map)) {
            expect(typeof handler.execute).toBe('function');
            expect(typeof handler.describe).toBe('function');
            expect(typeof handler.undoable).toBe('boolean');
        }
    });

    it('every handler.describe returns an object with a non-empty label', () => {
        const map = getControlRoomHandlers();
        for (const handler of Object.values(map)) {
            const description = handler.describe({ type: 'switchMonitor' } as never);
            expect(description).toBeDefined();
            expect(typeof description.label).toBe('string');
            expect(description.label.length).toBeGreaterThan(0);
        }
    });
});
