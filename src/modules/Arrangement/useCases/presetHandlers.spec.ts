import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeLoadPreset } from './presetHandlers';

describe('presetHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeLoadPreset loads preset onto track when trackId is set', () => {
        const preset = { id: 'p1', name: 'My Preset' };
        const getUserPresets = vi.fn(() => [preset]);
        const loadPresetToTrack = vi.fn();
        const createTrackFromPreset = vi.fn();
        injectDependencies(executeLoadPreset, { getUserPresets, loadPresetToTrack, createTrackFromPreset });

        executeLoadPreset({
            type: 'loadPreset',
            payload: { presetId: 'p1', trackId: 't1' },
        });

        expect(loadPresetToTrack).toHaveBeenCalledWith('t1', preset);
        expect(createTrackFromPreset).not.toHaveBeenCalled();
    });
});
