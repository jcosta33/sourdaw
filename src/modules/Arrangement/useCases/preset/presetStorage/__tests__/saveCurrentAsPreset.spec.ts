import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { type DevicePreset } from '../../../../models/SoundPreset';

const injectedWithheldDeviceTypes = vi.hoisted(() => new Set<string>());

vi.mock('#/infra/release/deviceReleaseAdmission', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/release/deviceReleaseAdmission')>();

    return {
        ...actual,
        findWithheldDeviceType: (devices: ReadonlyArray<{ type: string }>) =>
            devices.find(({ type }) => injectedWithheldDeviceTypes.has(type))?.type ??
            actual.findWithheldDeviceType(devices),
    };
});
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const devices = [
    {
        type: 'synth',
        name: 'Lead',
        parameterValues: {
            drive: 0.5,
        },
    },
] satisfies DevicePreset[];

describe('saveCurrentAsPreset', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        injectedWithheldDeviceTypes.clear();
        window.localStorage.clear();
    });

    it('should save the current preset through user preset storage defaults', async () => {
        const subject = await import('../saveCurrentAsPreset');
        const reader = await import('../readStoredPresets');

        const result = subject.saveCurrentAsPreset({
            name: 'My Lead',
            category: 'lead',
            trackKind: 'midi',
            devices,
        });

        if (!result) {
            throw new Error('Expected saved preset');
        }
        expect(result.id).toMatch(/^user-preset-/);
        expect(result).toEqual({
            id: result.id,
            name: 'My Lead',
            category: 'lead',
            description: '',
            trackKind: 'midi',
            devices,
            tags: [],
            author: 'User',
            isFactory: false,
        });
        expect(reader.readStoredPresets()).toEqual([result]);
    });

    it('rejects a preset containing a withheld device', async () => {
        injectedWithheldDeviceTypes.add('test-withheld-device');
        const subject = await import('../saveCurrentAsPreset');
        const reader = await import('../readStoredPresets');

        const result = subject.saveCurrentAsPreset({
            name: 'Withheld test device',
            category: 'keys',
            trackKind: 'midi',
            devices: [{ type: 'test-withheld-device', name: 'Withheld test device', parameterValues: {} }],
        });

        expect(result).toBeNull();
        expect(reader.readStoredPresets()).toEqual([]);
        expect(notifyUser).toHaveBeenCalledWith(
            'Preset contains withheld device "test-withheld-device" and was not saved.',
            'warning'
        );
    });

    it('saves a Grand Boule preset', async () => {
        const subject = await import('../saveCurrentAsPreset');
        const reader = await import('../readStoredPresets');

        const result = subject.saveCurrentAsPreset({
            name: 'Grand piano',
            category: 'keys',
            trackKind: 'midi',
            devices: [{ type: 'grand-boule', name: 'Grand Boule', parameterValues: {} }],
        });

        expect(result).not.toBeNull();
        expect(reader.readStoredPresets()).toEqual([result]);
    });
});
