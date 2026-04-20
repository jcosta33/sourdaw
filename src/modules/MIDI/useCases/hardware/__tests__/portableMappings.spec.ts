import { describe, it, expect, beforeEach } from 'vitest';

import { hardwareControllerStore } from '../../../stores/hardwareControllerStore';
import { exportHardwareMappings, importHardwareMappings } from '../portableMappings';

describe('portableMappings', () => {
    beforeEach(() => {
        hardwareControllerStore.set({
            connectedDevices: [],
            profiles: [
                {
                    id: 'p1',
                    name: 'Profile 1',
                    manufacturer: 'M',
                    productId: ['id1'],
                    mappings: [
                        {
                            id: 'm1',
                            controlType: 'button',
                            controlIndex: 1,
                            channel: 1,
                            action: { type: 'transport', target: 'play' },
                        },
                    ],
                },
            ],
        });
    });

    it('should export mappings as JSON', () => {
        const json = exportHardwareMappings('p1');
        expect(json).toContain('"id": "m1"');
        expect(json).toContain('"target": "play"');
    });

    it('should import mappings from JSON', () => {
        const newMappings = [
            {
                id: 'm2',
                controlType: 'knob',
                controlIndex: 10,
                channel: 2,
                action: { type: 'workflow', target: 'undo' },
            },
        ];
        importHardwareMappings('p1', JSON.stringify(newMappings));

        const profile = hardwareControllerStore.value?.profiles.find((p) => p.id === 'p1');
        expect(profile?.mappings[0]?.id).toBe('m2');
    });
});
