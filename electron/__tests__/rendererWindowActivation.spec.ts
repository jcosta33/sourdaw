import { describe, expect, it, vi } from 'vitest';

import { activateRendererWindow } from '../rendererWindowActivation.js';

describe('renderer window activation', () => {
    it('clears a stale crash/windowless queue before Dock reopen and waits for a new action', () => {
        const order: string[] = [];
        const created = { id: 'dock-window' };
        const result = activateRendererWindow({
            hasLiveWindow: () => false,
            clearPending: () => order.push('clear-stale-menu-queue'),
            createWindow: vi.fn(() => {
                order.push('create-window');
                return created;
            }),
        });

        expect(result).toBe(created);
        expect(order).toEqual(['clear-stale-menu-queue', 'create-window']);
    });
});
