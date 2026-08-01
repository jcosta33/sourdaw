import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeviceReadinessDiagnostics } from '../getDeviceReadinessDiagnostics';

const repositoryMocks = vi.hoisted(() => ({
    getDeviceReadinessDiagnostics: vi.fn(),
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        getDeviceReadinessDiagnostics: repositoryMocks.getDeviceReadinessDiagnostics,
    },
}));

describe('getDeviceReadinessDiagnostics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the active AudioEngine instance readiness snapshot', () => {
        const expected = {
            counts: { requested: 1 },
            devices: [{ deviceId: 'levain-1', status: 'node-pending' }],
        };
        repositoryMocks.getDeviceReadinessDiagnostics.mockReturnValue(expected);

        const snapshot = getDeviceReadinessDiagnostics();

        expect(repositoryMocks.getDeviceReadinessDiagnostics).toHaveBeenCalledOnce();
        expect(snapshot).toBe(expected);
    });
});
