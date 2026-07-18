import { describe, it, expect } from 'vitest';

import * as subject from '../getControlRoomHandlers';

describe('getControlRoomHandlers', () => {
    it('should export getControlRoomHandlers', () => {
        expect(subject.getControlRoomHandlers).toBeDefined();
        const time = typeof subject.getControlRoomHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('should expose the three live control-room handlers', () => {
        const map = subject.getControlRoomHandlers();
        expect(map.switchMonitor).toBeDefined();
        expect(map.toggleControlRoomDim).toBeDefined();
        expect(map.toggleControlRoomMono).toBeDefined();
    });
});
