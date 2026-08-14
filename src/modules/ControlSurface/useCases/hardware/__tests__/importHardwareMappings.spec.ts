import { describe, it, expect, beforeEach, vi } from 'vitest';

import { hardwareControllerStore } from '../../../stores/hardwareControllerStore';
import { importHardwareMappings } from '../importHardwareMappings';

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

const otherMapping = {
    id: 'm-other',
    controlType: 'fader' as const,
    controlIndex: 2,
    channel: 1,
    action: { type: 'parameter' as const, target: 'volume' },
};

describe('importHardwareMappings', () => {
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
                {
                    id: 'p2',
                    name: 'Profile 2',
                    manufacturer: 'M',
                    productId: ['id2'],
                    mappings: [otherMapping],
                },
            ],
        });
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
        const otherProfile = hardwareControllerStore.value?.profiles.find((param) => param.id === 'p2');
        expect(profile?.mappings[0]?.id).toBe('m2');
        expect(otherProfile?.mappings).toEqual([otherMapping]);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('should notify the user and leave mappings untouched when the JSON is malformed', () => {
        importHardwareMappings('p1', '{ not valid json');

        const profile = hardwareControllerStore.value?.profiles.find((param) => param.id === 'p1');
        expect(profile?.mappings).toEqual([baseMapping]);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser.mock.calls[0]?.[0]).toContain('Failed to import hardware mappings');
        expect(mocks.notifyUser.mock.calls[0]?.[1]).toBe('error');
    });

    it('should notify the user and leave mappings untouched when an entry has the wrong shape', () => {
        const invalid = [
            {
                id: 'mX',
                controlType: 'spinner',
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

    it('should reject a non-array document', () => {
        importHardwareMappings('p1', JSON.stringify({ id: 'm2' }));

        const profile = hardwareControllerStore.value?.profiles.find((param) => param.id === 'p1');
        expect(profile?.mappings).toEqual([baseMapping]);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
    });

    it('should notify the user when profileId matches no known profile instead of silently doing nothing (F-8)', () => {
        importHardwareMappings('unknown-profile', JSON.stringify([baseMapping]));

        const profiles = hardwareControllerStore.value?.profiles;
        expect(profiles?.find((param) => param.id === 'p1')?.mappings).toEqual([baseMapping]);
        expect(profiles?.find((param) => param.id === 'p2')?.mappings).toEqual([otherMapping]);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser.mock.calls[0]?.[0]).toContain('unknown-profile');
        expect(mocks.notifyUser.mock.calls[0]?.[1]).toBe('error');
    });
});
