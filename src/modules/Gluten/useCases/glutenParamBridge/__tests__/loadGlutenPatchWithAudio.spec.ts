import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

import { DEFAULT_PATCH, type GlutenPatch } from '../../../models/GlutenPatch';
import { loadGlutenPatchWithAudio } from '../loadGlutenPatchWithAudio';

const { resolveEligibleDeviceWriteTarget, pushParamImmediately, loadGlutenPatch } = vi.hoisted(() => ({
    resolveEligibleDeviceWriteTarget: vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(),
    pushParamImmediately: vi.fn<(deviceId: string, key: string, value: number) => void>(),
    loadGlutenPatch: vi.fn<(deviceId: string, patch: GlutenPatch) => void>(),
}));

vi.mock('../helpers', async (importActual) => {
    const actual = await importActual<typeof import('../helpers')>();
    return {
        ...actual,
        bridgeDeps: {
            ...actual.bridgeDeps,
            resolveEligibleDeviceWriteTarget,
        },
    };
});

vi.mock('../createFlushHandlers', () => ({
    createFlushHandlers: () => ({
        flushParam: vi.fn(),
        pushParamImmediately: (deviceId: string, key: string, value: number): void =>
            pushParamImmediately(deviceId, key, value),
    }),
}));

vi.mock('../../../stores/glutenStore', () => ({
    loadGlutenPatch: (deviceId: string, patch: GlutenPatch): void => loadGlutenPatch(deviceId, patch),
}));

function pushedValueFor(key: string): unknown {
    const call = pushParamImmediately.mock.calls.find(([, paramKey]) => paramKey === key);
    return call?.[2];
}

describe('loadGlutenPatchWithAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 't1',
            deviceId: 'dev',
        });
    });

    it('should export loadGlutenPatchWithAudio', () => {
        expect(typeof loadGlutenPatchWithAudio).toBe('function');
    });

    it('should push every encodable param to the engine', () => {
        loadGlutenPatchWithAudio('dev', { ...DEFAULT_PATCH });
        expect(pushParamImmediately).toHaveBeenCalled();
        // A representative encodable enum and number both reach the engine.
        expect(pushedValueFor('topology')).toBe(0); // 'vca'
        expect(pushedValueFor('threshold')).toBe(DEFAULT_PATCH.threshold);
    });

    describe('fix 2 — observable desync on unencodable value', () => {
        it('should warn and skip the push when a param fails to encode', () => {
            const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
            // `topology` is a string enum; an unknown member does not encode.
            const patch: GlutenPatch = { ...DEFAULT_PATCH, topology: 'tube' as GlutenPatch['topology'] };

            loadGlutenPatchWithAudio('dev', patch);

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipped param "topology"'), 'tube');
            // The desynced param must NOT have been pushed to the engine.
            expect(pushParamImmediately.mock.calls.some(([, key]) => key === 'topology')).toBe(false);
            // Other params still flow through.
            expect(pushedValueFor('threshold')).toBe(DEFAULT_PATCH.threshold);

            warnSpy.mockRestore();
        });

        it('should not warn when every param encodes cleanly', () => {
            const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

            loadGlutenPatchWithAudio('dev', { ...DEFAULT_PATCH });

            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    describe('fix 3 — oversampling snapped before store and engine', () => {
        it('should snap an invalid oversampling of 3 to 2 in the stored patch and the pushed value', () => {
            const patch: GlutenPatch = { ...DEFAULT_PATCH, oversampling: 3 as GlutenPatch['oversampling'] };

            loadGlutenPatchWithAudio('dev', patch);

            const storedPatch = loadGlutenPatch.mock.calls[0]?.[1] as GlutenPatch;
            expect(storedPatch.oversampling).toBe(2);
            expect(pushedValueFor('oversampling')).toBe(2);
        });

        it('should leave a supported oversampling factor untouched', () => {
            const patch: GlutenPatch = { ...DEFAULT_PATCH, oversampling: 4 };

            loadGlutenPatchWithAudio('dev', patch);

            const storedPatch = loadGlutenPatch.mock.calls[0]?.[1] as GlutenPatch;
            expect(storedPatch.oversampling).toBe(4);
            expect(pushedValueFor('oversampling')).toBe(4);
        });
    });

    it.each(['missing', 'ineligible'] as const)(
        'rejects a %s owner before store, logging, or engine effects',
        (status) => {
            const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
            resolveEligibleDeviceWriteTarget.mockReturnValue({ status });

            loadGlutenPatchWithAudio('dev', DEFAULT_PATCH);

            expect(loadGlutenPatch).not.toHaveBeenCalled();
            expect(pushParamImmediately).not.toHaveBeenCalled();
            expect(warnSpy).not.toHaveBeenCalled();
        }
    );
});
