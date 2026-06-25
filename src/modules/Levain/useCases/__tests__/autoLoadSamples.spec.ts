import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../repositories/sampleLoader/helpers', () => ({
    WEB_LOD: 0,
}));

vi.mock('../../repositories/sampleLoader/loadInstrumentFromManifest', () => ({
    loadInstrumentFromManifest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/levainStore', () => ({
    setSampleLoadProgress: vi.fn(),
    setSampleLoadError: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
    resolveResource: vi.fn().mockResolvedValue('/resolved/path'),
}));

import { loadInstrumentFromManifest } from '../../repositories/sampleLoader/loadInstrumentFromManifest';
import { setSampleLoadError, setSampleLoadProgress } from '../../stores/levainStore';
import { autoLoadLevainSamples } from '../autoLoadSamples';

describe('autoLoadLevainSamples', () => {
    beforeEach(() => {
        vi.mocked(loadInstrumentFromManifest).mockReset();
        vi.mocked(loadInstrumentFromManifest).mockResolvedValue(undefined);
        vi.mocked(setSampleLoadProgress).mockClear();
        vi.mocked(setSampleLoadError).mockClear();
        vi.useFakeTimers();
    });

    it('reports progress and calls the loader with the manifest URL', async () => {
        const port = {} as MessagePort;

        await autoLoadLevainSamples('d1', port, 'violin-1');

        expect(setSampleLoadProgress).toHaveBeenCalledWith('d1', 0.01);
        expect(loadInstrumentFromManifest).toHaveBeenCalledWith(
            expect.stringContaining('/samples/levain/violin-1/manifest.json'),
            expect.stringContaining('/samples/levain/violin-1'),
            port,
            0,
            expect.any(Function),
            undefined
        );
        expect(setSampleLoadProgress).toHaveBeenCalledWith('d1', 1.0);
    });

    describe('fix 3 — load failures surface an error instead of a synthetic 100%', () => {
        it('records an error and never claims completion when the loader rejects', async () => {
            vi.mocked(loadInstrumentFromManifest).mockRejectedValueOnce(new Error('boom'));

            await autoLoadLevainSamples('d1', {} as MessagePort, 'cello');

            expect(setSampleLoadError).toHaveBeenCalledWith('d1', 'boom');
            // The old code set progress to 1.0 in a finally even on error.
            expect(setSampleLoadProgress).not.toHaveBeenCalledWith('d1', 1.0);
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
            vi.mocked(loadInstrumentFromManifest).mockImplementationOnce(async () => {
                controller.abort();
            });

            await autoLoadLevainSamples('d1', {} as MessagePort, 'flute', controller.signal);

            expect(setSampleLoadProgress).not.toHaveBeenCalledWith('d1', 1.0);
        });

        it('stays silent (no error) when an aborted load rejects', async () => {
            const controller = new AbortController();
            vi.mocked(loadInstrumentFromManifest).mockImplementationOnce(async () => {
                controller.abort();
                throw new Error('aborted decode');
            });

            await autoLoadLevainSamples('d1', {} as MessagePort, 'oboe', controller.signal);

            expect(setSampleLoadError).not.toHaveBeenCalled();
        });
    });
});
