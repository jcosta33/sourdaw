import { describe, it, expect } from 'vitest';

import { getSessionLauncherHandlers } from '../getSessionLauncherHandlers';

describe('getSessionLauncherHandlers', () => {
    it('returns a fresh map containing every session-launcher command handler', () => {
        const map = getSessionLauncherHandlers();
        for (const key of ['toggleLoopRecord', 'triggerScene'] as const) {
            expect(map[key]).toBeDefined();
            expect(map[key].execute).toBeDefined();
        }
        expect(getSessionLauncherHandlers()).not.toBe(map);
    });
});
