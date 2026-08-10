import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
    invoke: mockInvoke,
}));

import { disableLink } from '../disableLink';
import { enableLink } from '../enableLink';
import { getLinkStatus } from '../getLinkStatus';

function setTauriAvailable(): void {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
        configurable: true,
        value: {},
    });
}

function clearTauriAvailability(): void {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
}

describe('linkBridge repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearTauriAvailability();
    });

    afterEach(() => {
        clearTauriAvailability();
    });

    describe('getLinkStatus', () => {
        it('should return status from Tauri', async () => {
            setTauriAvailable();
            const mockStatus = {
                supported: false,
                implementation: 'unsupported',
                enabled: false,
                tempo: 120,
                quantum: 4,
                beat: 0,
                phase: 0,
                num_peers: 0,
                message: 'Ableton Link is unavailable',
            };
            mockInvoke.mockResolvedValue(mockStatus);

            const status = await getLinkStatus();
            expect(status).toEqual(mockStatus);
        });
    });

    describe('enableLink / disableLink', () => {
        it('should call tauri commands', async () => {
            setTauriAvailable();

            await enableLink();
            expect(mockInvoke).toHaveBeenCalledWith('enable_link', undefined);

            await disableLink();
            expect(mockInvoke).toHaveBeenCalledWith('disable_link', undefined);
        });
    });
});
