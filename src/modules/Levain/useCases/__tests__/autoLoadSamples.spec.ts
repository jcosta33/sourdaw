import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../repositories/sampleLoader/helpers', () => ({
    WEB_LOD: 0,
}));

vi.mock('../../repositories/sampleLoader/loadInstrumentFromManifest', () => ({
    loadInstrumentFromManifest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/levainStore', () => ({
    setSampleLoadProgress: vi.fn(),
    setSampleLoadError: vi.fn(),
    setLoadedMicPositions: vi.fn(),
}));

vi.mock('../../repositories/sampleLoader/resolveSampleBasePath', () => ({
    resolveSampleBasePath: vi.fn((instrumentId: string) => Promise.resolve(`/samples/levain/${instrumentId}`)),
}));

import { loadInstrumentFromManifest } from '../../repositories/sampleLoader/loadInstrumentFromManifest';
import { setLoadedMicPositions, setSampleLoadError, setSampleLoadProgress } from '../../stores/levainStore';
import { autoLoadLevainSamples } from '../autoLoadSamples';

describe('autoLoadLevainSamples', () => {
    beforeEach(() => {
        vi.mocked(loadInstrumentFromManifest).mockReset();
        vi.mocked(loadInstrumentFromManifest).mockResolvedValue(undefined);
        vi.mocked(setSampleLoadProgress).mockClear();
        vi.mocked(setSampleLoadError).mockClear();
        vi.mocked(setLoadedMicPositions).mockClear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reports progress and calls the loader with the manifest URL', async () => {
        const port = {} as MessagePort;

        await autoLoadLevainSamples('d1', port, 'violin-1');

        expect(setSampleLoadProgress).toHaveBeenCalledWith('d1', 0.01);
        expect(loadInstrumentFromManifest).toHaveBeenCalledTimes(1);
        const loadCall = vi.mocked(loadInstrumentFromManifest).mock.calls[0];
        if (!loadCall) {
            throw new Error('Expected one Levain manifest load');
        }
        expect(loadCall[0]).toMatchObject({
            manifestUrl: '/samples/levain/violin-1/manifest.json',
            basePath: '/samples/levain/violin-1',
            expectedInstrumentId: 'violin-1',
            nodePort: port,
            lod: 0,
            signal: undefined,
        });
        expect(loadCall[0].onProgress).toEqual(expect.any(Function));
        expect(setSampleLoadProgress).toHaveBeenCalledWith('d1', 1.0);
    });

    describe('the 300ms completion-clear and its abort guard', () => {
        it('clears the progress bar 300ms after a successful load completes', async () => {
            await autoLoadLevainSamples('d1', {} as MessagePort, 'violin-1');

            expect(setSampleLoadProgress).toHaveBeenCalledWith('d1', 1.0);
            expect(setSampleLoadProgress).not.toHaveBeenCalledWith('d1', null);

            vi.advanceTimersByTime(300);

            expect(setSampleLoadProgress).toHaveBeenCalledWith('d1', null);
        });

        it('does not clear the bar when the load was superseded before the delay fires', async () => {
            const controller = new AbortController();

            await autoLoadLevainSamples('d1', {} as MessagePort, 'violin-1', controller.signal);

            // Completion ran (1.0 set) and scheduled the clear; a newer load now
            // supersedes this one before the 300ms timer fires.
            expect(setSampleLoadProgress).toHaveBeenCalledWith('d1', 1.0);
            controller.abort();

            vi.advanceTimersByTime(300);

            expect(setSampleLoadProgress).not.toHaveBeenCalledWith('d1', null);
        });
    });

    describe('fix 3 — load failures surface an error instead of a synthetic 100%', () => {
        it('records an error and never claims completion when the loader rejects', async () => {
            vi.mocked(loadInstrumentFromManifest).mockRejectedValueOnce(new Error('boom'));

            await expect(autoLoadLevainSamples('d1', {} as MessagePort, 'cello')).rejects.toThrow('boom');

            expect(setSampleLoadError).toHaveBeenCalledWith('d1', 'boom');
            // The old code set progress to 1.0 in a finally even on error.
            expect(setSampleLoadProgress).not.toHaveBeenCalledWith('d1', 1.0);
        });
    });

    describe('loadedMicPositions — the shared route every UI load path funnels through', () => {
        // registerLevainDevice (web live registration), loadInstrument (preset
        // load and instrument change) all call this function through
        // loadSamplesForInstrument; this is the one place that must clear and
        // set the store's loadedMicPositions for every one of those routes.
        it('clears loadedMicPositions before starting a new load', async () => {
            await autoLoadLevainSamples('d1', {} as MessagePort, 'violin-1');

            expect(setLoadedMicPositions).toHaveBeenNthCalledWith(1, 'd1', null);
        });

        it('stores the loaded bank names on a successful load', async () => {
            vi.mocked(loadInstrumentFromManifest).mockResolvedValueOnce({
                micPositions: ['close', 'room'],
            } as unknown as Awaited<ReturnType<typeof loadInstrumentFromManifest>>);

            await autoLoadLevainSamples('d1', {} as MessagePort, 'violin-1');

            expect(setLoadedMicPositions).toHaveBeenCalledWith('d1', ['close', 'room']);
        });

        it('clears loadedMicPositions when the load fails', async () => {
            vi.mocked(loadInstrumentFromManifest).mockRejectedValueOnce(new Error('boom'));

            await expect(autoLoadLevainSamples('d1', {} as MessagePort, 'cello')).rejects.toThrow('boom');

            expect(setLoadedMicPositions).toHaveBeenLastCalledWith('d1', null);
        });
    });

    describe('fix 2 — a superseded (aborted) load bails without owning the UI', () => {
        it('does not start the loader when already aborted', async () => {
            const controller = new AbortController();
            controller.abort();

            await autoLoadLevainSamples('d1', {} as MessagePort, 'viola', controller.signal);

            expect(loadInstrumentFromManifest).not.toHaveBeenCalled();
            expect(setSampleLoadProgress).not.toHaveBeenCalled();
        });

        it('does not claim 100% when aborted after the loader resolves', async () => {
            const controller = new AbortController();
            vi.mocked(loadInstrumentFromManifest).mockImplementationOnce(() => {
                controller.abort();
                return Promise.resolve(undefined);
            });

            await autoLoadLevainSamples('d1', {} as MessagePort, 'flute', controller.signal);

            expect(setSampleLoadProgress).not.toHaveBeenCalledWith('d1', 1.0);
        });

        it('stays silent (no error) when an aborted load rejects', async () => {
            const controller = new AbortController();
            vi.mocked(loadInstrumentFromManifest).mockImplementationOnce(() => {
                controller.abort();
                return Promise.reject(new Error('aborted decode'));
            });

            await autoLoadLevainSamples('d1', {} as MessagePort, 'oboe', controller.signal);

            expect(setSampleLoadError).not.toHaveBeenCalled();
        });
    });
});
