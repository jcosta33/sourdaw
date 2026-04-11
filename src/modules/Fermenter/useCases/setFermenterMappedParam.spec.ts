import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./fermenterParamBridge', () => ({
    setFermenterParamWithAudio: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { setFermenterMappedParam } from './setFermenterMappedParam';
import { setFermenterParamWithAudio } from './fermenterParamBridge';
import { logger } from '#/infra/logger/appLogger';
import { FERMENTER_PARAMS } from './fermenterQueries';

describe('setFermenterMappedParam', () => {
    beforeEach(() => {
        vi.mocked(setFermenterParamWithAudio).mockClear();
        vi.mocked(logger.warn).mockClear();
    });

    it('forwards a known param to the audio bridge', () => {
        const known = FERMENTER_PARAMS[0]!.id;
        setFermenterMappedParam({ deviceId: 'd1', paramId: known, value: 0.5 });

        expect(setFermenterParamWithAudio).toHaveBeenCalledWith('d1', known, 0.5);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warns and skips for unknown param ids', () => {
        setFermenterMappedParam({ deviceId: 'd1', paramId: '__unknown__', value: 1 });

        expect(setFermenterParamWithAudio).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });
});
