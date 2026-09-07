import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { importScoringTuning } from '#/modules/AudioEngine/useCases';

import { mergeDeviceState } from '../../stores/tunerStore';
import { importTuningScale } from '../importTuningScale';

vi.mock('#/modules/Arrangement/stores', () => ({
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    importScoringTuning: vi.fn(),
}));

vi.mock('../../stores/tunerStore', () => ({
    mergeDeviceState: vi.fn(),
}));

describe('importTuningScale', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(resolveEligibleDeviceWriteTarget).mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'dev-1',
        });
    });

    it('returns { ok: false } when the target device is not eligible', async () => {
        vi.mocked(resolveEligibleDeviceWriteTarget).mockReturnValue({ status: 'missing' });

        const result = await importTuningScale('dev-1', 'scala', 'scale content');

        expect(result).toEqual({ ok: false });
        expect(importScoringTuning).not.toHaveBeenCalled();
        expect(mergeDeviceState).not.toHaveBeenCalled();
    });

    it('forwards to importScoringTuning and updates tunerStore with scale description on success', async () => {
        vi.mocked(importScoringTuning).mockResolvedValue({ ok: true, name: 'Just Intonation' });

        const result = await importTuningScale('dev-1', 'scala', 'scale content');

        expect(importScoringTuning).toHaveBeenCalledWith('track-1', 'dev-1', 'scala', 'scale content');
        expect(mergeDeviceState).toHaveBeenCalledWith('dev-1', { scaleName: 'Just Intonation' });
        expect(result).toEqual({ ok: true, name: 'Just Intonation' });
    });

    it('does not update tunerStore when import fails or returns false', async () => {
        vi.mocked(importScoringTuning).mockResolvedValue({ ok: false });

        const result = await importTuningScale('dev-1', 'scala', 'malformed');

        expect(importScoringTuning).toHaveBeenCalledWith('track-1', 'dev-1', 'scala', 'malformed');
        expect(mergeDeviceState).not.toHaveBeenCalled();
        expect(result).toEqual({ ok: false });
    });
});
