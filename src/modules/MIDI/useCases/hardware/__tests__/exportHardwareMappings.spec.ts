import { describe, it, expect, beforeEach } from 'vitest';

import { hardwareControllerStore } from '../../../stores/hardwareControllerStore';
import { exportHardwareMappings } from '../exportHardwareMappings';

const baseMapping = {
    id: 'm1',
    controlType: 'button' as const,
    controlIndex: 1,
    channel: 1,
    action: { type: 'transport' as const, target: 'play' },
};

describe('exportHardwareMappings', () => {
    beforeEach(() => {
        hardwareControllerStore.set({
            connectedDevices: [],
            profiles: [
                {
                    id: 'p1',
                    name: 'Profile 1',
                    manufacturer: 'M',
                    productId: ['id1'],
                    mappings: [baseMapping],
                },
            ],
        });
    });

    it('should export mappings as JSON', () => {
        const json = exportHardwareMappings('p1');
        expect(json).toContain('"id": "m1"');
        expect(json).toContain('"target": "play"');
    });

    it('should return null when the profile is missing', () => {
        expect(exportHardwareMappings('missing')).toBeNull();
    });
});
