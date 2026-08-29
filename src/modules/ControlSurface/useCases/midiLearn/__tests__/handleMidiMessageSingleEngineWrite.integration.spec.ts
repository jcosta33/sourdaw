import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import {
    getAllTracks,
    setTrackGain as setTrackGainArrangement,
    setTrackPan as setTrackPanArrangement,
} from '#/modules/Arrangement/useCases';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { midiLearnStore, type MidiMapping } from '../../../stores/midiLearnStore';
import { handleMidiMessage } from '../handleMidiMessage';
import { setMidiLearnDependencies } from '../midiLearnDependencies';

import type { Track } from '#/modules/Arrangement/stores';

/**
 * The composition proof behind #2772: a learned trackGain/trackPan message must
 * reach the audio engine exactly once.
 *
 * `handleMidiMessage` used to write the store through the Arrangement setter and
 * then write the engine directly behind its back. The Arrangement setter already
 * writes the engine itself, so every controller event drove `TrackNode`'s
 * `setTargetAtTime` smoothing twice and restarted the ramp mid-flight. The unit
 * spec can only count calls on the owning setter; the double write lived in the
 * wiring, so this spec runs the real composition — the Arrangement setters
 * registered as the MIDI-learn dependencies exactly as `bootstrap.ts` registers
 * them — with only the audio-engine seam stubbed so it can be counted.
 *
 * The Arrangement setters' own specs pin what each single write carries: the
 * fader-law clamp, the persisted project value, and the automation ride while an
 * armed track plays.
 */
const mocks = vi.hoisted(() => ({
    engineSetTrackGain: vi.fn(),
    engineSetTrackPan: vi.fn(),
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackGain: mocks.engineSetTrackGain,
    setTrackPan: mocks.engineSetTrackPan,
    updateDeviceParam: mocks.updateDeviceParam,
}));

const baseTrack: Track = {
    id: 'track1',
    name: 'Track 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    color: '#fff',
    clips: [],
    devices: [],
    sends: [],
    midiFx: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 80,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
};

const learnMapping = (overrides: Partial<MidiMapping>): void => {
    midiLearnStore.set({
        mappingsSchemaVersion: 1,
        mappings: [
            {
                id: 'm1',
                channel: 0,
                cc: 7,
                targetType: 'trackGain',
                trackId: 'track1',
                minValue: 0,
                maxValue: 1,
                scaleMode: 'linear',
                ...overrides,
            },
        ],
        isLearning: false,
        learningTarget: null,
    });
};

describe('handleMidiMessage single engine write', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [{ ...baseTrack }], selectedTrackId: null, ghostClips: [] });
        setMidiLearnDependencies({
            setTrackGainArrangement,
            setTrackPanArrangement,
            setDeviceParameter: vi.fn(),
            setFermenterMappedParam: vi.fn(),
            recordAutomationValue: vi.fn(),
            getTransportIsPlaying: () => false,
            getTransportPlayheadPosition: () => 0,
            getAllTracks,
        });
    });

    it('writes a learned trackGain message to the engine exactly once, clamped, with project truth intact', () => {
        // maxValue past the fader ceiling: the scaled handoff is 2.5, and the
        // one write that reaches the engine carries the fader law's clamp.
        learnMapping({ maxValue: 2.5 });

        handleMidiMessage(0, 7, 127);

        expect(mocks.engineSetTrackGain).toHaveBeenCalledTimes(1);
        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('track1', FADER_MAX_GAIN);
        expect(trackStore.value?.tracks[0]?.gain).toBe(FADER_MAX_GAIN);
    });

    it('writes a learned trackPan message to the engine exactly once with project truth intact', () => {
        learnMapping({ targetType: 'trackPan', minValue: -50, maxValue: 50 });

        handleMidiMessage(0, 7, 127);

        expect(mocks.engineSetTrackPan).toHaveBeenCalledTimes(1);
        expect(mocks.engineSetTrackPan).toHaveBeenCalledWith('track1', 50);
        expect(trackStore.value?.tracks[0]?.pan).toBe(50);
    });
});
