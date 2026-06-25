import { describe, it, expect, beforeEach } from 'vitest';

import { createDefaultPatch } from '../../models/LevainPatch';
import {
    defaultLevainState,
    levainStore,
    setEngineReady,
    setLevainParam,
    setMacro,
    setSampleLoadError,
    setSampleLoadProgress,
    updateMicPosition,
    type LevainState,
} from '../levainStore';

const DEVICE = 'dev-1';

function seedDevice(overrides: Partial<LevainState> = {}): void {
    levainStore.set({
        [DEVICE]: {
            ...defaultLevainState,
            patch: createDefaultPatch('violin-1'),
            ...overrides,
        },
    });
}

describe('levainStore mutators', () => {
    beforeEach(() => {
        levainStore.set({});
    });

    describe('fix 11 — no-op for an unregistered device', () => {
        // Each setter previously fabricated a defaultLevainState entry on a
        // missing deviceId and wrote it back, resurrecting a phantom violin
        // instance after the device had been unregistered.

        it('setLevainParam does not create an entry for a missing device', () => {
            setLevainParam('ghost', 'masterGain', 0.2);
            expect(levainStore.value?.ghost).toBeUndefined();
        });

        it('setMacro does not create an entry for a missing device', () => {
            setMacro('ghost', 0, 1);
            expect(levainStore.value?.ghost).toBeUndefined();
        });

        it('updateMicPosition does not create an entry for a missing device', () => {
            updateMicPosition('ghost', 0, { volume: 0.5 });
            expect(levainStore.value?.ghost).toBeUndefined();
        });

        it('setSampleLoadProgress does not create an entry for a missing device', () => {
            setSampleLoadProgress('ghost', 0.5);
            expect(levainStore.value?.ghost).toBeUndefined();
        });

        it('setSampleLoadError does not create an entry for a missing device', () => {
            setSampleLoadError('ghost', 'boom');
            expect(levainStore.value?.ghost).toBeUndefined();
        });

        it('setEngineReady does not create an entry for a missing device', () => {
            setEngineReady('ghost', true);
            expect(levainStore.value?.ghost).toBeUndefined();
        });

        it('does not resurrect an entry whose device was unregistered mid-flight', () => {
            seedDevice();
            // Simulate unregisterLevainDevice deleting the entry.
            levainStore.set({});
            // A late param flush arrives for the now-gone device.
            setLevainParam(DEVICE, 'masterGain', 0.9);
            expect(levainStore.value?.[DEVICE]).toBeUndefined();
        });

        it('still mutates a registered device', () => {
            seedDevice();
            setLevainParam(DEVICE, 'masterGain', 0.42);
            expect(levainStore.value?.[DEVICE]?.patch.masterGain).toBe(0.42);
        });
    });

    describe('fix 7 — updateMicPosition clamps volume to [0,1]', () => {
        it('clamps a volume above 1 down to 1', () => {
            seedDevice();
            updateMicPosition(DEVICE, 0, { volume: 1.8 });
            expect(levainStore.value?.[DEVICE]?.patch.micPositions[0]?.volume).toBe(1);
        });

        it('clamps a negative volume up to 0', () => {
            seedDevice();
            updateMicPosition(DEVICE, 0, { volume: -0.5 });
            expect(levainStore.value?.[DEVICE]?.patch.micPositions[0]?.volume).toBe(0);
        });

        it('passes an in-range volume through untouched', () => {
            seedDevice();
            updateMicPosition(DEVICE, 0, { volume: 0.4 });
            expect(levainStore.value?.[DEVICE]?.patch.micPositions[0]?.volume).toBe(0.4);
        });

        it('leaves non-volume updates (pan) unchanged', () => {
            seedDevice();
            updateMicPosition(DEVICE, 0, { pan: -0.7 });
            expect(levainStore.value?.[DEVICE]?.patch.micPositions[0]?.pan).toBe(-0.7);
        });
    });

    describe('fix 3 — sample-load error state', () => {
        it('records an error and clears any in-flight progress', () => {
            seedDevice({ sampleLoadProgress: 0.6 });
            setSampleLoadError(DEVICE, 'Failed to fetch manifest');
            expect(levainStore.value?.[DEVICE]?.sampleLoadError).toBe('Failed to fetch manifest');
            expect(levainStore.value?.[DEVICE]?.sampleLoadProgress).toBeNull();
        });

        it('clears a prior error when a fresh load starts', () => {
            seedDevice({ sampleLoadError: 'old failure' });
            setSampleLoadProgress(DEVICE, 0.01);
            expect(levainStore.value?.[DEVICE]?.sampleLoadError).toBeNull();
        });

        it('keeps the error while a load is idle (progress null)', () => {
            seedDevice({ sampleLoadError: 'still broken', sampleLoadProgress: 0.5 });
            setSampleLoadProgress(DEVICE, null);
            expect(levainStore.value?.[DEVICE]?.sampleLoadError).toBe('still broken');
        });
    });
});
