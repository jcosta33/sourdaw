import { beforeEach, describe, expect, it } from 'vitest';

import { deviceReadinessDiagnostics } from '../../../services/deviceReadinessDiagnostics';
import { getDeviceReadinessDiagnostics } from '../getDeviceReadinessDiagnostics';

describe('getDeviceReadinessDiagnostics', () => {
    beforeEach(() => {
        deviceReadinessDiagnostics.reset();
    });

    it('returns the current AudioEngine-owned readiness snapshot', () => {
        deviceReadinessDiagnostics.begin({
            deviceId: 'levain-1',
            deviceType: 'levain',
            requiresContent: true,
            atMs: 1_000,
        });

        const snapshot = getDeviceReadinessDiagnostics();

        expect(snapshot.counts.requested).toBe(1);
        expect(snapshot.devices).toEqual([expect.objectContaining({ deviceId: 'levain-1', status: 'node-pending' })]);
    });
});
