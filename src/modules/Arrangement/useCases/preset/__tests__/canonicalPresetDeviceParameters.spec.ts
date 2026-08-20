import { describe, expect, it } from 'vitest';

import { type SoundPreset } from '../../../models/SoundPreset';
import { canonicalPresetDeviceParameters } from '../canonicalPresetDeviceParameters';
import { matchesMaterializedPresetDevices } from '../matchesMaterializedPresetDevices';
import { materializePresetDevices } from '../materializePresetDevices';

function presetWithLegacyLimiterRelease(): SoundPreset {
    return {
        id: 'preset-legacy-release',
        name: 'Legacy Limiter',
        category: 'fx',
        description: '',
        trackKind: 'audio',
        // Saved before the Brick-Wall Limiter's `release` moved from seconds
        // (0.01..1, default 0.1) to milliseconds (1..1000, default 100): 0.1
        // was a legal 100 ms release under the old declaration.
        devices: [{ type: 'faust-brick-wall-limiter', name: 'Limiter', parameterValues: { release: 0.1 } }],
        tags: [],
        author: 'test',
        isFactory: false,
    };
}

describe('canonicalPresetDeviceParameters', () => {
    it('migrates a stored pre-unit-change value before clamping to the current range', () => {
        const result = canonicalPresetDeviceParameters('faust-brick-wall-limiter', { release: 0.1 });

        expect(result).toEqual({ release: 100 });
    });
});

describe('materializePresetDevices legacy unit migration', () => {
    it('reads a stored 100 ms release, not the new range minimum, for a preset saved under the old unit', () => {
        const materialized = materializePresetDevices(presetWithLegacyLimiterRelease());

        expect(materialized).not.toBeNull();
        expect(materialized?.[0]?.parameterValues).toEqual({ release: 100 });
    });

    it('admits the migrated snapshot on the CRDT recheck path', () => {
        const preset = presetWithLegacyLimiterRelease();
        const materialized = materializePresetDevices(preset);
        expect(materialized).not.toBeNull();

        expect(matchesMaterializedPresetDevices(preset, materialized ?? [])).toBe(true);
    });
});
