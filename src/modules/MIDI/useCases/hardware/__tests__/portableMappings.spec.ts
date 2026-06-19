import { describe, it, expect, beforeEach, vi } from 'vitest';

import { hardwareControllerStore } from '../../../stores/hardwareControllerStore';
import { exportHardwareMappings, importHardwareMappings } from '../portableMappings';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn<typeof import('#/utils/Notification/notifyUser').notifyUser>(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

const baseMapping = {
    id: 'm1',
    controlType: 'button' as const,
    controlIndex: 1,
    channel: 1,
    action: { type: 'transport' as const, target: 'play' },
};

describe('portableMappings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

        const profile = hardwareControllerStore.value?.profiles.find((param) => param.id === 'p1');
        expect(profile?.mappings[0]?.id).toBe('m2');
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('notifies the user and leaves mappings untouched when the JSON is malformed', () => {
        importHardwareMappings('p1', '{ not valid json');

        const profile = hardwareControllerStore.value?.profiles.find((param) => param.id === 'p1');
        expect(profile?.mappings).toEqual([baseMapping]);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser.mock.calls[0]?.[0]).toContain('Failed to import hardware mappings');
        expect(mocks.notifyUser.mock.calls[0]?.[1]).toBe('error');
    });

    it('notifies the user and leaves mappings untouched when an entry has the wrong shape', () => {
        const invalid = [
            {
                id: 'mX',
                controlType: 'spinner', // not a valid control type
                controlIndex: 3,
                channel: 1,
                action: { type: 'transport' },
            },
        ];
        importHardwareMappings('p1', JSON.stringify(invalid));

        const profile = hardwareControllerStore.value?.profiles.find((param) => param.id === 'p1');
        expect(profile?.mappings).toEqual([baseMapping]);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser.mock.calls[0]?.[1]).toBe('error');
    });

    it('rejects a non-array document', () => {
        importHardwareMappings('p1', JSON.stringify({ id: 'm2' }));

        const profile = hardwareControllerStore.value?.profiles.find((param) => param.id === 'p1');
        expect(profile?.mappings).toEqual([baseMapping]);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
    });
});
