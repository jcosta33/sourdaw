import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { refreshCreatedClipStateGuard, stampCreatedClipStateGuard } from '../stampCreatedClipStateGuard';

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

describe('refreshCreatedClipStateGuard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', clips: [copy] }] });
        mocks.serializeMidiStateForClips.mockReturnValue('midi-now');
        mocks.serializeClipSatelliteEntries.mockReturnValue('satellites-now');
        mocks.serializeClipScopedAutomationLanes.mockReturnValue('lanes-now');
    });

    it('re-reads every leg a duplicate guard carries', () => {
        const recorded: GeneratedMidiStateGuard = {
            entityJson: 'entity-then',
            midiByClipIdJson: 'midi-then',
            clipSatellitesJson: 'satellites-then',
            clipAutomationLanesJson: 'lanes-then',
        };

        expect(refreshCreatedClipStateGuard(recorded, 'copy')).toEqual({
            entityJson: JSON.stringify(copy),
            midiByClipIdJson: 'midi-now',
            clipSatellitesJson: 'satellites-now',
            clipAutomationLanesJson: 'lanes-now',
        });
        expect(recorded.midiByClipIdJson).toBe('midi-then');
    });

    it('keeps absent legs on their absence check', () => {
        const recorded: GeneratedMidiStateGuard = { entityJson: 'entity-then', midiByClipIdJson: 'midi-then' };

        const refreshed = refreshCreatedClipStateGuard(recorded, 'copy');

        expect(refreshed).toEqual({ entityJson: JSON.stringify(copy), midiByClipIdJson: 'midi-now' });
        expect(Object.hasOwn(refreshed, 'clipSatellitesJson')).toBe(false);
        expect(Object.hasOwn(refreshed, 'clipAutomationLanesJson')).toBe(false);
    });

    it('keeps the recorded guard when the clip is on no track', () => {
        const recorded: GeneratedMidiStateGuard = { entityJson: 'entity-then', midiByClipIdJson: 'midi-then' };

        expect(refreshCreatedClipStateGuard(recorded, 'missing')).toBe(recorded);
    });
});
