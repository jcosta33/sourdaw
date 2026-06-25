import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { type DeviceRef } from '#/utils/createFindDeviceRef';

import { DEFAULT_PATCH, type GlutenPatch } from '../../../models/GlutenPatch';
import { loadGlutenPatchWithAudio } from '../loadGlutenPatchWithAudio';

const findDeviceRefGluten = vi.fn<(deviceId: string) => DeviceRef | null>();
const pushParamImmediately = vi.fn<(ref: DeviceRef, key: string, value: number) => void>();
const loadGlutenPatch = vi.fn<(deviceId: string, patch: GlutenPatch) => void>();

vi.mock('../helpers', async (importActual) => {
    const actual = await importActual<typeof import('../helpers')>();
    return {
        ...actual,
        // Keep the real encoder so the null-encode path is exercised genuinely,
        // but stub the side-effecting bridge boundaries.
        findDeviceRefGluten: (deviceId: string): DeviceRef | null => findDeviceRefGluten(deviceId),
        pushParamImmediately: (ref: DeviceRef, key: string, value: number): void =>
            pushParamImmediately(ref, key, value),
    };
});

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
        findDeviceRefGluten.mockReturnValue({ trackId: 't1', deviceId: 'dev' });
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
});
