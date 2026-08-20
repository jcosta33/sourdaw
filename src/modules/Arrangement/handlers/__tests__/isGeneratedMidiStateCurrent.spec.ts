import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '../../useCases/createTrack';
import { isGeneratedMidiStateCurrent } from '../isGeneratedMidiStateCurrent';

const mocks = vi.hoisted(() => ({
    getAllSidechainRoutes: vi.fn(),
    getAutomationLanes: vi.fn(),
    getEnvelope: vi.fn(),
    getTrackStoreState: vi.fn(),
    hasNonDefaultWarpState: vi.fn(),
    modulationStore: { value: { modulators: [] } },
    serializeMidiStateForClips: vi.fn(),
    takeLaneStore: { value: { lanes: [] } },
}));

vi.mock('#/modules/Automation/stores', () => ({ modulationStore: mocks.modulationStore }));
vi.mock('#/modules/Automation/useCases', () => ({ getAutomationLanes: mocks.getAutomationLanes }));
vi.mock('#/modules/MIDI/useCases', () => ({ serializeMidiStateForClips: mocks.serializeMidiStateForClips }));
vi.mock('#/modules/Routing/useCases', () => ({ getAllSidechainRoutes: mocks.getAllSidechainRoutes }));
vi.mock('../../stores/gainEnvelopeStore', () => ({ getEnvelope: mocks.getEnvelope }));
vi.mock('../../stores/takeLaneStore', () => ({ takeLaneStore: mocks.takeLaneStore }));
vi.mock('../../stores/warpStates', () => ({ hasNonDefaultWarpState: mocks.hasNonDefaultWarpState }));
vi.mock('../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));

const generatedClip = {
    id: 'generated-clip',
    trackId: 'generated-track',
    name: 'Bassline',
    startBeat: 0,
    endBeat: 4,
    type: 'midi' as const,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '',
    locked: false,
    muted: false,
};

describe('isGeneratedMidiStateCurrent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllSidechainRoutes.mockReturnValue([]);
        mocks.getAutomationLanes.mockReturnValue([]);
        mocks.getEnvelope.mockReturnValue(undefined);
        mocks.serializeMidiStateForClips.mockReturnValue('exact-midi');
        mocks.hasNonDefaultWarpState.mockReturnValue(false);
        mocks.modulationStore.value = { modulators: [] };
        mocks.takeLaneStore.value = { lanes: [] };
    });

    it('accepts an exact generated track and its exact MIDI subtree', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedTrack.id,
                entityType: 'track',
                guard: {
                    entityJson: JSON.stringify(generatedTrack),
                    midiByClipIdJson: 'exact-midi',
                },
            })
        ).toBe(true);
        expect(mocks.serializeMidiStateForClips).toHaveBeenCalledWith(['generated-clip']);
    });

    it('rejects deletion after MIDI or dependent routing changes', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        const routedTrack = {
            ...createTrack({ id: 'routed-track', name: 'Lead', kind: 'midi' }),
            outputId: generatedTrack.id,
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack, routedTrack] });
        mocks.serializeMidiStateForClips.mockReturnValue('edited-midi');

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedTrack.id,
                entityType: 'track',
                guard: {
                    entityJson: JSON.stringify(generatedTrack),
                    midiByClipIdJson: 'exact-midi',
                },
            })
        ).toBe(false);

        mocks.serializeMidiStateForClips.mockReturnValue('exact-midi');
        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedTrack.id,
                entityType: 'track',
                guard: {
                    entityJson: JSON.stringify(generatedTrack),
                    midiByClipIdJson: 'exact-midi',
                },
            })
        ).toBe(false);
    });

    it('rejects a clip carrying non-default warp state, and is wired through hasNonDefaultWarpState not map presence', () => {
        const generatedTrack = {
            ...createTrack({ id: 'generated-track', name: 'Bass', kind: 'midi' }),
            clips: [generatedClip],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [generatedTrack] });
        mocks.hasNonDefaultWarpState.mockReturnValue(true);

        expect(
            isGeneratedMidiStateCurrent({
                entityId: generatedClip.id,
                entityType: 'clip',
                guard: {
                    entityJson: JSON.stringify(generatedClip),
                    midiByClipIdJson: 'exact-midi',
                },
            })
        ).toBe(false);
        expect(mocks.hasNonDefaultWarpState).toHaveBeenCalledWith('generated-clip');
    });
});
