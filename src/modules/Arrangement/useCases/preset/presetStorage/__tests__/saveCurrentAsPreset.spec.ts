import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { type DevicePreset } from '../../../../models/SoundPreset';

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
        const subject = await import('../saveCurrentAsPreset');
        const reader = await import('../readStoredPresets');

        const result = subject.saveCurrentAsPreset({
            name: 'Withheld piano',
            category: 'keys',
            trackKind: 'midi',
            devices: [{ type: 'grand-boule', name: 'Grand Boule', parameterValues: {} }],
        });

        expect(result).toBeNull();
        expect(reader.readStoredPresets()).toEqual([]);
        expect(notifyUser).toHaveBeenCalledWith(
            'Preset contains withheld device "grand-boule" and was not saved.',
            'warning'
        );
    });
});
