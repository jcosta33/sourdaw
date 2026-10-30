import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
    decode: vi.fn(),
    telemetry: vi.fn(),
    peaks: vi.fn(),
}));

vi.mock('../../repositories/crumbsBridge/loadSample', () => ({ loadSample: bridge.decode }));
vi.mock('../../repositories/crumbsBridge/getCrumbsDroppedSampleWrites', () => ({
    getCrumbsDroppedSampleWrites: bridge.telemetry,
}));
vi.mock('../../repositories/crumbsBridge/getWaveformPeaks', () => ({ getWaveformPeaks: bridge.peaks }));

import {
    crumbsStore,
    ensureInstance,
    setActiveSample,
    setWaveformPeaks,
    setLoading,
    setTune,
    setMetering,
} from '../../stores/crumbsStore';
import { configureCrumbsSampleProjectAccess } from '../configureCrumbsSampleProjectAccess';
import { loadSampleFromPath } from '../loadSample';

import type { CrumbsLoadResult, SampleMeta } from '../../models/CrumbsTypes';

const DEVICE = 'waveform-owner';
const FIRST_PEAKS = [-0.9, 0.8, -0.7, 0.6];
const SECOND_PEAKS = [-0.2, 0.3, -0.1, 0.4];

function decoded(sampleId: number): CrumbsLoadResult {
    return {
        sampleId,
        sampleRate: 48000,
        channels: 1,
        frameCount: sampleId * 1000,
        durationSecs: sampleId / 48,
        detectedRoot: 60,
        detectedBpm: null,
        category: 'tonal',
        decodeWarningCount: 0,
        decodeWarnings: [],
    };
}

function sample(sampleId: number, filePath: string): SampleMeta {
    const result = decoded(sampleId);
    return {
        sampleId,
        sampleRate: result.sampleRate,
        channels: result.channels,
        frameCount: result.frameCount,
        durationSecs: result.durationSecs,
        detectedRoot: result.detectedRoot,
        detectedBpm: result.detectedBpm,
        category: 'tonal',
        filePath,
        fileName: filePath.slice(1),
    };
}

function state() {
    const current = crumbsStore.value?.[DEVICE];
    if (!current) {
        throw new Error('Expected the real Crumbs instance');
    }
    return current;
}

async function holdFirstPeaks() {
    const response = Promise.withResolvers<number[]>();
    const entered = Promise.withResolvers<void>();
    bridge.peaks.mockImplementationOnce(() => {
        entered.resolve();
        return response.promise;
    });
    const completion = loadSampleFromPath(DEVICE, '/a.wav');
    await entered.promise;
    return {
        finish: async (peaks: number[] = FIRST_PEAKS) => {
            response.resolve(peaks);
            await completion;
        },
        fail: async () => {
            response.reject(new Error('peak failure'));
            await completion;
        },
    };
}

describe('sample waveform publication ownership', () => {
    let owner: number | null;
    let disposeAccess: () => void;
    beforeEach(() => {
        vi.resetAllMocks();
        crumbsStore.set({});
        ensureInstance(DEVICE);
        owner = 1;
        disposeAccess = configureCrumbsSampleProjectAccess(() => owner);
        bridge.decode.mockImplementation((_id: string, path: string) =>
            Promise.resolve(decoded(path === '/a.wav' ? 1 : 2))
        );
        bridge.telemetry.mockResolvedValue(0);
        bridge.peaks.mockImplementation((_id: string, sampleId: number) =>
            Promise.resolve(sampleId === 1 ? FIRST_PEAKS : SECOND_PEAKS)
        );
    });

    afterEach(() => {
        disposeAccess();
        crumbsStore.set({});
    });

    it('retains the newer metadata and exact peaks after the older peak response settles', async () => {
        const held = Promise.withResolvers<number[]>();
        const entered = Promise.withResolvers<void>();
        bridge.peaks.mockImplementation((_id: string, sampleId: number) => {
            if (sampleId === 1) {
                entered.resolve();
                return held.promise;
            }
            return Promise.resolve(SECOND_PEAKS);
        });

        const first = loadSampleFromPath(DEVICE, '/a.wav');
        await entered.promise;
        await loadSampleFromPath(DEVICE, '/b.wav');
        const accepted = state().activeSample;
        held.resolve(FIRST_PEAKS);
        await first;

        expect(state().activeSample).toBe(accepted);
        expect(state().activeSample?.filePath).toBe('/b.wav');
        expect(state().waveformPeaks).toEqual(SECOND_PEAKS);
        expect(state().isLoading).toBe(false);
    });

    it('does not request stale peaks or clear a pending successor after telemetry settles', async () => {
        const telemetry = Promise.withResolvers<number>();
        const telemetryEntered = Promise.withResolvers<void>();
        const secondDecode = Promise.withResolvers<CrumbsLoadResult>();
        const secondEntered = Promise.withResolvers<void>();
        bridge.telemetry.mockImplementationOnce(() => {
            telemetryEntered.resolve();
            return telemetry.promise;
        });
        bridge.decode.mockImplementation((_id: string, path: string) => {
            if (path === '/b.wav') {
                secondEntered.resolve();
                return secondDecode.promise;
            }
            return Promise.resolve(decoded(1));
        });

        const first = loadSampleFromPath(DEVICE, '/a.wav');
        await telemetryEntered.promise;
        const second = loadSampleFromPath(DEVICE, '/b.wav');
        await secondEntered.promise;
        telemetry.resolve(0);
        await first;
        const loadingWhileSecondDecodes = state().isLoading;
        const requestsBeforeSecondDecode = bridge.peaks.mock.calls.slice();
        secondDecode.resolve(decoded(2));
        await second;

        expect(loadingWhileSecondDecodes).toBe(true);
        expect(requestsBeforeSecondDecode).toEqual([]);
        expect(state().activeSample?.filePath).toBe('/b.wav');
        expect(state().waveformPeaks).toEqual(SECOND_PEAKS);
    });

    it('clears old peaks atomically when the accepted sample changes', () => {
        setActiveSample(DEVICE, sample(1, '/a.wav'));
        setWaveformPeaks(DEVICE, FIRST_PEAKS);

        setActiveSample(DEVICE, sample(2, '/b.wav'));

        expect(state().activeSample?.filePath).toBe('/b.wav');
        expect(state().waveformPeaks).toEqual([]);
    });

    it('completes a current load with its matching waveform', async () => {
        await loadSampleFromPath(DEVICE, '/a.wav');

        expect(state().activeSample?.filePath).toBe('/a.wav');
        expect(state().waveformPeaks).toEqual(FIRST_PEAKS);
        expect(state().isLoading).toBe(false);
    });

    it('retains same-effective metadata cache while refusing an earlier leaf continuation', async () => {
        const first = await holdFirstPeaks();
        const accepted = state().activeSample;
        if (!accepted) {
            throw new Error('Expected accepted metadata before the peak wait');
        }
        setWaveformPeaks(DEVICE, FIRST_PEAKS);
        const replacement = structuredClone(accepted);
        setActiveSample(DEVICE, replacement);
        setLoading(DEVICE, true);
        await first.finish(SECOND_PEAKS);

        expect(state().activeSample).toBe(replacement);
        expect(state().waveformPeaks).toBe(FIRST_PEAKS);
        expect(state().isLoading).toBe(true);
    });

    it('rejects a same-ID different sample without another load', async () => {
        const first = await holdFirstPeaks();
        const replacement = sample(1, '/replacement.wav');
        setActiveSample(DEVICE, replacement);
        setLoading(DEVICE, true);
        await first.finish();

        expect(state().activeSample).toBe(replacement);
        expect(state().waveformPeaks).toEqual([]);
        expect(state().isLoading).toBe(true);
    });

    it.each([null, 2])('refuses a peak response after the configured owner becomes %s', async (replacement) => {
        const first = await holdFirstPeaks();
        owner = replacement;
        setLoading(DEVICE, true);
        await first.finish();

        expect(state().waveformPeaks).toEqual([]);
        expect(state().isLoading).toBe(true);
    });

    it('does not let an old registration borrow a replacement reader with the same numeric token', async () => {
        const first = await holdFirstPeaks();
        const disposeReplacement = configureCrumbsSampleProjectAccess(() => 1);
        disposeAccess();
        await first.finish();
        expect(state().waveformPeaks).toEqual([]);

        await loadSampleFromPath(DEVICE, '/b.wav');
        expect(state().waveformPeaks).toEqual(SECOND_PEAKS);
        disposeReplacement();
    });

    it('refuses work after access disposal and without a registered owner', async () => {
        const first = await holdFirstPeaks();
        disposeAccess();
        await first.finish();
        await loadSampleFromPath(DEVICE, '/b.wav');

        expect(bridge.decode).toHaveBeenCalledTimes(1);
        expect(state().waveformPeaks).toEqual([]);
    });

    it('preserves ordinary tune and metering edits while accepting the current waveform', async () => {
        const first = await holdFirstPeaks();
        const accepted = state().activeSample;
        setTune(DEVICE, 7);
        setMetering(DEVICE, 0.4, 0.6, 3);
        await first.finish();

        expect(state().activeSample).toBe(accepted);
        expect(state().waveformPeaks).toEqual(FIRST_PEAKS);
        expect(state()).toMatchObject({ tune: 7, peakLeft: 0.4, peakRight: 0.6, activeVoices: 3 });
    });

    it('keeps another device independent of a held request', async () => {
        const first = await holdFirstPeaks();
        ensureInstance('independent-device');
        await loadSampleFromPath('independent-device', '/b.wav');
        await first.finish();

        expect(state().waveformPeaks).toEqual(FIRST_PEAKS);
        expect(crumbsStore.value?.['independent-device']?.waveformPeaks).toEqual(SECOND_PEAKS);
    });

    it('rechecks ownership after synchronous metadata subscribers start a successor', async () => {
        let started = false;
        let successor: Promise<void> | undefined;
        const stop = crumbsStore.subscribe((instances) => {
            if (!started && instances?.[DEVICE]?.activeSample?.filePath === '/a.wav') {
                started = true;
                successor = loadSampleFromPath(DEVICE, '/b.wav');
            }
        });
        try {
            await loadSampleFromPath(DEVICE, '/a.wav');
            if (!successor) {
                throw new Error('Expected a successor from the real store subscriber');
            }
            await successor;
        } finally {
            stop();
        }

        expect(bridge.telemetry).toHaveBeenCalledTimes(1);
        expect(bridge.peaks).toHaveBeenCalledExactlyOnceWith(DEVICE, 2, 0);
        expect(state().activeSample?.filePath).toBe('/b.wav');
        expect(state().waveformPeaks).toEqual(SECOND_PEAKS);
    });

    it('rechecks ownership after peak subscribers start a pending successor', async () => {
        const decode = Promise.withResolvers<CrumbsLoadResult>();
        bridge.decode.mockImplementation((_id: string, path: string) => {
            if (path === '/b.wav') {
                return decode.promise;
            }
            return Promise.resolve(decoded(1));
        });
        let started = false;
        let successor: Promise<void> | undefined;
        const stop = crumbsStore.subscribe((instances) => {
            if (!started && instances?.[DEVICE]?.waveformPeaks === FIRST_PEAKS) {
                started = true;
                successor = loadSampleFromPath(DEVICE, '/b.wav');
            }
        });
        let loadingAfterFirst: boolean;
        try {
            await loadSampleFromPath(DEVICE, '/a.wav');
            loadingAfterFirst = state().isLoading;
            decode.resolve(decoded(2));
            if (!successor) {
                throw new Error('Expected the peak subscriber to start its successor');
            }
            await successor;
        } finally {
            stop();
        }

        expect(loadingAfterFirst).toBe(true);
        expect(state().activeSample?.filePath).toBe('/b.wav');
        expect(state().waveformPeaks).toEqual(SECOND_PEAKS);
    });

    it('keeps a current peak failure accepted with empty new-sample peaks', async () => {
        setActiveSample(DEVICE, sample(2, '/previous.wav'));
        setWaveformPeaks(DEVICE, SECOND_PEAKS);
        const first = await holdFirstPeaks();
        await first.fail();

        expect(state().activeSample?.filePath).toBe('/a.wav');
        expect(state().waveformPeaks).toEqual([]);
        expect(state().isLoading).toBe(false);
    });

    it('does not clear a replacement when stale peaks reject', async () => {
        const first = await holdFirstPeaks();
        await loadSampleFromPath(DEVICE, '/b.wav');
        setLoading(DEVICE, true);
        await first.fail();

        expect(state().activeSample?.filePath).toBe('/b.wav');
        expect(state().waveformPeaks).toEqual(SECOND_PEAKS);
        expect(state().isLoading).toBe(true);
    });

    it('retains the previous metadata/cache and rejection policy when current decode fails', async () => {
        const previous = sample(2, '/previous.wav');
        setActiveSample(DEVICE, previous);
        setWaveformPeaks(DEVICE, SECOND_PEAKS);
        bridge.decode.mockRejectedValue(new Error('decode refused'));

        await expect(loadSampleFromPath(DEVICE, '/a.wav')).rejects.toThrow('decode refused');

        expect(state().activeSample).toBe(previous);
        expect(state().waveformPeaks).toBe(SECOND_PEAKS);
        expect(state().isLoading).toBe(false);
    });

    it('continues a current load after telemetry rejects', async () => {
        bridge.telemetry.mockRejectedValue(new Error('telemetry unavailable'));
        await loadSampleFromPath(DEVICE, '/a.wav');

        expect(state().waveformPeaks).toEqual(FIRST_PEAKS);
        expect(state().isLoading).toBe(false);
    });

    it('does not request peaks after telemetry rejects beneath a changed owner', async () => {
        const telemetry = Promise.withResolvers<number>();
        const entered = Promise.withResolvers<void>();
        bridge.telemetry.mockImplementationOnce(() => {
            entered.resolve();
            return telemetry.promise;
        });
        const first = loadSampleFromPath(DEVICE, '/a.wav');
        await entered.promise;
        owner = 2;
        setLoading(DEVICE, true);
        telemetry.reject(new Error('outgoing telemetry failed'));
        await first;

        expect(bridge.peaks).not.toHaveBeenCalled();
        expect(state().isLoading).toBe(true);
    });
});
