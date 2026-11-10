import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { stampCreatedClipStateGuard } from '../stampCreatedClipStateGuard';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    serializeMidiStateForClips: vi.fn(),
    serializeClipSatelliteEntries: vi.fn(),
    serializeClipScopedAutomationLanes: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('#/modules/MIDI/useCases', () => ({ serializeMidiStateForClips: mocks.serializeMidiStateForClips }));
vi.mock('../../../stores/clipSatelliteState', () => ({
    serializeClipSatelliteEntries: mocks.serializeClipSatelliteEntries,
}));
vi.mock('../../../useCases/clip/serializeClipScopedAutomationLanes', () => ({
    serializeClipScopedAutomationLanes: mocks.serializeClipScopedAutomationLanes,
}));

const copy = { id: 'copy', trackId: 't1', name: 'Copy', startBeat: 4, endBeat: 8 };

describe('stampCreatedClipStateGuard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [copy] }] });
        mocks.serializeMidiStateForClips.mockReturnValue('midi-now');
        mocks.serializeClipSatelliteEntries.mockReturnValue('satellites-now');
        mocks.serializeClipScopedAutomationLanes.mockReturnValue('lanes-now');
    });

    it('writes all four legs of the copy into the guard the inverse holds', () => {
        const guard: GeneratedMidiStateGuard = { entityJson: '', midiByClipIdJson: '' };

        stampCreatedClipStateGuard(guard, 'copy');

        expect(guard).toEqual({
            entityJson: JSON.stringify(copy),
            midiByClipIdJson: 'midi-now',
            clipSatellitesJson: 'satellites-now',
            clipAutomationLanesJson: 'lanes-now',
        });
        expect(mocks.serializeMidiStateForClips).toHaveBeenCalledWith(['copy']);
        expect(mocks.serializeClipSatelliteEntries).toHaveBeenCalledWith(['copy']);
        expect(mocks.serializeClipScopedAutomationLanes).toHaveBeenCalledWith(['copy']);
    });

    it('leaves the guard untouched when the copy is on no track', () => {
        const guard: GeneratedMidiStateGuard = { entityJson: '', midiByClipIdJson: '' };

        stampCreatedClipStateGuard(guard, 'missing');

        expect(guard).toEqual({ entityJson: '', midiByClipIdJson: '' });
    });
});
