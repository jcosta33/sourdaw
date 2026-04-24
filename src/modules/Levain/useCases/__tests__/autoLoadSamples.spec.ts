import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../repositories/sampleLoader/helpers', () => ({
    WEB_LOD: 0,
}));

vi.mock('../../repositories/sampleLoader/loadInstrumentFromManifest', () => ({
    loadInstrumentFromManifest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/levainStore', () => ({
    setSampleLoadProgress: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
    resolveResource: vi.fn().mockResolvedValue('/resolved/path'),
}));

import { loadInstrumentFromManifest } from '../../repositories/sampleLoader/loadInstrumentFromManifest';
import { setSampleLoadProgress } from '../../stores/levainStore';
import { autoLoadLevainSamples } from '../autoLoadSamples';

describe('autoLoadLevainSamples', () => {
    beforeEach(() => {
        vi.mocked(loadInstrumentFromManifest).mockClear();
        vi.mocked(setSampleLoadProgress).mockClear();
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
            expect.any(Function)
        );
        expect(setSampleLoadProgress).toHaveBeenCalledWith('d1', 1.0);
    });

    it('still completes when the loader rejects', async () => {
        vi.mocked(loadInstrumentFromManifest).mockRejectedValueOnce(new Error('boom'));

        await autoLoadLevainSamples('d1', {} as MessagePort, 'cello-1');

        expect(setSampleLoadProgress).toHaveBeenCalledWith('d1', 1.0);
    });
});
