import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';
import { resolveDrumKitDef } from '#/modules/Synth/useCases';

import { resolveDrumKit } from '../../../services/deviceResolution';
import { scheduleTrackClips } from '../scheduleTrackClips';

// The drum resolvers stay real: the claim is that the export resolves the kit
// the live scheduler resolves, so only the note-level schedulers are observed.
const mocks = vi.hoisted(() => ({
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNoteOffline: vi.fn(),
}));

vi.mock('#/modules/Synth/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Synth/useCases')>();
    return {
        ...actual,
        scheduleDrumKitNote: mocks.scheduleDrumKitNote,
        scheduleKitNote: mocks.scheduleKitNote,
        scheduleNoteOffline: mocks.scheduleNoteOffline,
    };
});

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: () => 0,
}));

vi.mock('../../../repositories/offlineScheduler/automationScheduling', () => ({
    scheduleTrackAutomation: vi.fn(),
}));

type DrumDevice = { type: string; parameterValues: Record<string, number> };

// Kit indices the catalog assigns each variant (`createDrumVariant`).
const KIT_DEVICES: readonly DrumDevice[] = [
    { type: 'builtin-drum-machine-808', parameterValues: { kit: 0 } },
    { type: 'builtin-drum-machine-analog', parameterValues: { kit: 1 } },
    { type: 'builtin-drum-machine-electronic', parameterValues: { kit: 2 } },
    { type: 'builtin-drum-machine-acoustic', parameterValues: { kit: 3 } },
    { type: 'builtin-drum-kit', parameterValues: { kit: 0 } },
    { type: 'builtin-drum-kit', parameterValues: { kit: 1 } },
    { type: 'drum-kit', parameterValues: { kit: 0 } },
    { type: 'drum-kit', parameterValues: { kitId: 1 } },
];

const PITCHES = [36, 37, 38, 39, 40, 42, 43, 44, 45, 46, 47, 48, 49, 50, 56, 62, 63, 64, 70, 75];

async function renderNotes(device: DrumDevice, pitches: readonly number[]): Promise<void> {
    const track = {
        id: 'track-drums',
        kind: 'midi',
        muted: false,
        gain: 1,
        pan: 0,
        parentId: null,
        followChordTrack: false,
        automationMode: 'read',
        freezeState: { status: 'unfrozen' },
        sends: [],
        devices: [{ id: 'drum-1', name: 'Drums', bypassed: false, ...device }],
        clips: [
            {
                id: 'clip-1',
                trackId: 'track-drums',
                name: 'Drums',
                startBeat: 0,
                endBeat: 8,
                type: 'midi',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#fff',
                locked: false,
                muted: false,
            },
        ],
    } as unknown as Track;
    const midi: NonNullable<MidiStoreState> = {
        probabilitySeed: 1,
        notesByClipId: {
            'clip-1': pitches.map((pitch, index) => ({
                id: `note-${pitch}`,
                pitch,
                startBeat: index * 0.25,
                duration: 0.25,
                velocity: 100,
            })),
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    };

    await scheduleTrackClips({
        offlineCtx: { sampleRate: 48_000, currentTime: 0 } as unknown as OfflineAudioContext,
        track,
        midi,
        trackInputNode: {} as GainNode,
        trackGainNode: {} as GainNode,
        trackPanNode: {} as StereoPannerNode,
        destination: {} as AudioNode,
        durationSeconds: 60,
        defaultTempo: 120,
        changes: [],
        projections: {
            projectMidiEvents: (input) => input.events,
            projectPpqEndpoints: ({ startPpq, endPpq, defaultTempo, sampleRate }) => {
                const startSamples = Math.round((startPpq / defaultTempo) * 60 * sampleRate);
                const endSamples = Math.round((endPpq / defaultTempo) * 60 * sampleRate);
                return {
                    startSamples,
                    endSamples,
                    durationSamples: endSamples - startSamples,
                    startSeconds: startSamples / sampleRate,
                    endSeconds: endSamples / sampleRate,
                    durationSeconds: (endSamples - startSamples) / sampleRate,
                };
            },
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
            processYeastMidi: null,
            selectMidiEventProbability: () => true,
            projectChordPitch: ({ pitch }) => pitch,
            evaluateAutomationValue: null,
        },
        pendingWorkletEvents: [],
        allTracks: [track],
        deviceEntriesByTrack: new Map([[track.id, []]]),
    });
}

function scheduledPitches(calls: readonly unknown[][], pitchIndex: number): number[] {
    return calls.map((call) => call[pitchIndex] as number);
}

describe('scheduleTrackClips — drum kit resolution matches live playback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each(KIT_DEVICES)('voices $type kit $parameterValues with the kit live resolves', async (device) => {
        await renderNotes(device, PITCHES);

        const liveKitDef = resolveDrumKitDef([device]);
        if (liveKitDef) {
            expect(mocks.scheduleKitNote).not.toHaveBeenCalled();
            expect(mocks.scheduleDrumKitNote).toHaveBeenCalledTimes(PITCHES.length);
            for (const call of mocks.scheduleDrumKitNote.mock.calls) {
                expect(call[2]).toBe(liveKitDef);
            }
            expect(scheduledPitches(mocks.scheduleDrumKitNote.mock.calls, 3)).toEqual(PITCHES);
            return;
        }

        const liveKit = resolveDrumKit([device]);
        expect(liveKit).not.toBeNull();
        expect(mocks.scheduleDrumKitNote).not.toHaveBeenCalled();
        expect(mocks.scheduleKitNote).toHaveBeenCalledTimes(PITCHES.length);
        for (const call of mocks.scheduleKitNote.mock.calls) {
            expect(call[2]).toBe(liveKit);
        }
        expect(scheduledPitches(mocks.scheduleKitNote.mock.calls, 3)).toEqual(PITCHES);
    });

    it('voices the 808 variant with the dedicated 15-voice kit, not the factory 808', async () => {
        await renderNotes({ type: 'builtin-drum-machine-808', parameterValues: { kit: 0 } }, [36]);

        const kitDef = mocks.scheduleDrumKitNote.mock.calls[0]?.[2] as { id: string; voices: unknown[] };
        expect(kitDef.id).toBe('kit-808');
        expect(kitDef.voices).toHaveLength(15);
        expect(mocks.scheduleKitNote).not.toHaveBeenCalled();
    });

    // Pitch -> voice type the dedicated 808 kit definition declares. 44 and 49
    // have no voice there, so live is silent for them too; the export must not
    // invent a sound for either.
    it.each([
        [36, 'kick'],
        [37, 'rimshot'],
        [39, 'clap'],
        [42, 'closed-hh'],
        [46, 'open-hh'],
        [50, 'tom-high'],
        [44, undefined],
        [49, undefined],
    ] as const)('808 variant note %i resolves voice %s as live does', async (pitch, voiceType) => {
        const device = { type: 'builtin-drum-machine-808', parameterValues: { kit: 0 } };
        await renderNotes(device, [pitch]);

        expect(mocks.scheduleDrumKitNote).toHaveBeenCalledTimes(1);
        const [, , kitDef, scheduledPitch] = mocks.scheduleDrumKitNote.mock.calls[0] as [
            unknown,
            unknown,
            ReturnType<typeof resolveDrumKitDef>,
            number,
        ];
        expect(kitDef).toBe(resolveDrumKitDef([device]));
        expect(kitDef?.voices.find((voice) => voice.midiNote === scheduledPitch)?.type).toBe(voiceType);
        expect(mocks.scheduleKitNote).not.toHaveBeenCalled();
    });
});
