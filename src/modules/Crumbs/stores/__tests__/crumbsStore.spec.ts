import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    applyCrumbsParamValue,
    beginCrumbsParamPreview,
    crumbsStore,
    defaultCrumbsState,
    endCrumbsParamPreview,
    ensureInstance,
    replaceCrumbsProjectParameters,
    setMasterGain,
    setActiveSample,
    setWaveformPeaks,
    setTune,
} from '../crumbsStore';

import type { SampleMeta } from '../../models/CrumbsTypes';

const DEVICE = 'gain-clamp-test';

function readGain(): number | undefined {
    return crumbsStore.value?.[DEVICE]?.masterGain;
}

function metadata(filePath: string): SampleMeta {
    return {
        sampleId: 1,
        sampleRate: 48000,
        channels: 1,
        frameCount: 1000,
        durationSecs: 1 / 48,
        detectedRoot: 67,
        detectedBpm: null,
        category: 'tonal',
        filePath,
        fileName: filePath.slice(1),
    };
}

describe('active sample and waveform pairing', () => {
    beforeEach(() => {
        crumbsStore.set({});
        ensureInstance(DEVICE);
    });
    afterEach(() => {
        crumbsStore.set({});
    });

    it('clears the old vector in the same notification as changed metadata and preserves controls', () => {
        setActiveSample(DEVICE, metadata('/a.wav'));
        setWaveformPeaks(DEVICE, [-0.9, 0.8]);
        setTune(DEVICE, 7);
        const observed: { path: string | undefined; peaks: number[] | undefined }[] = [];
        const stop = crumbsStore.subscribe((instances) => {
            observed.push({
                path: instances?.[DEVICE]?.activeSample?.filePath,
                peaks: instances?.[DEVICE]?.waveformPeaks,
            });
        });
        try {
            setActiveSample(DEVICE, metadata('/b.wav'));
        } finally {
            stop();
        }

        expect(observed).toEqual([{ path: '/b.wav', peaks: [] }]);
        expect(crumbsStore.value?.[DEVICE]).toMatchObject({ tune: 7, rootNote: 67, isLoading: false });
    });

    it('retains the exact cache on a same-effective metadata replay while accepting the fresh leaf', () => {
        const first = metadata('/a.wav');
        const peaks = [-0.9, 0.8];
        setActiveSample(DEVICE, first);
        setWaveformPeaks(DEVICE, peaks);
        const replay = { ...first };

        setActiveSample(DEVICE, replay);

        expect(crumbsStore.value?.[DEVICE]?.activeSample).toBe(replay);
        expect(crumbsStore.value?.[DEVICE]?.waveformPeaks).toBe(peaks);
    });
});

describe('setMasterGain', () => {
    beforeEach(() => {
        crumbsStore.set({});
        ensureInstance(DEVICE);
    });

    afterEach(() => {
        crumbsStore.set({});
    });

    // Regression for inventory item #5: the Crumbs Rust engine does
    // `master_gain.set(value)` with no clamp (crates/daw-dsp/src/crumbs/engine.rs),
    // so the store — the single source of truth for every caller — must bound the
    // value to the engine's 0..=2 range before it propagates to the backend.
    it('clamps a value above the max to 2', () => {
        setMasterGain(DEVICE, 2.5);
        expect(readGain()).toBe(2);
    });

    it('clamps a negative value to 0', () => {
        setMasterGain(DEVICE, -1);
        expect(readGain()).toBe(0);
    });

    it('stores an in-range value unchanged', () => {
        setMasterGain(DEVICE, 1.0);
        expect(readGain()).toBe(1.0);
    });
});

describe('replaceCrumbsProjectParameters', () => {
    beforeEach(() => {
        crumbsStore.set({
            [DEVICE]: {
                ...defaultCrumbsState,
                waveformPeaks: [0.25, 0.5],
                envelope: { ...defaultCrumbsState.envelope, attack: 0.7 },
                voiceStack: { ...defaultCrumbsState.voiceStack, stackCount: 6 },
            },
        });
    });

    it('projects nested and root controls without resetting runtime-only state', () => {
        replaceCrumbsProjectParameters(DEVICE, { masterGain: 0.4, attack: 0.2, stackCount: 3 });

        expect(crumbsStore.value?.[DEVICE]).toMatchObject({
            masterGain: 0.4,
            waveformPeaks: [0.25, 0.5],
            envelope: { attack: 0.2 },
            voiceStack: { stackCount: 3 },
        });

        replaceCrumbsProjectParameters(DEVICE, { masterGain: 0.6 });
        expect(crumbsStore.value?.[DEVICE]).toMatchObject({
            masterGain: 0.6,
            envelope: { attack: defaultCrumbsState.envelope.attack },
            voiceStack: { stackCount: defaultCrumbsState.voiceStack.stackCount },
        });
    });

    it('preserves an active preview while reconciling unrelated project changes', () => {
        beginCrumbsParamPreview(DEVICE, 'masterGain');
        applyCrumbsParamValue(DEVICE, 'masterGain', 0.3);

        replaceCrumbsProjectParameters(DEVICE, { masterGain: defaultCrumbsState.masterGain, tune: 4 });
        expect(crumbsStore.value?.[DEVICE]).toMatchObject({ masterGain: 0.3, tune: 4 });

        endCrumbsParamPreview(DEVICE, 'masterGain');
        replaceCrumbsProjectParameters(DEVICE, { masterGain: 0.6, tune: 4 });
        expect(crumbsStore.value?.[DEVICE]?.masterGain).toBe(0.6);
    });
});
