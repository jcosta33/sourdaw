import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';

import { getDrumKitByIndex } from '../../../models/FactoryDrumKits';
import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { scheduleTrackClips } from '../scheduleTrackClips';
import { type PendingWorkletEvent } from '../types';

// Only the two leaf voice schedulers are observed. Everything above them —
// device resolution, the drum-kit definitions, the factory kit table, the
// kit-note schedulers — is production code, so the spec reads what an export
// would actually hand to a voice.
const leaves = vi.hoisted(() => ({
    scheduleDrumVoice: vi.fn(),
    scheduleNote: vi.fn(),
}));

vi.mock('#/modules/Synth/engine/drumSynthVoices', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Synth/engine/drumSynthVoices')>();
    return { ...actual, scheduleDrumVoice: leaves.scheduleDrumVoice };
});

vi.mock('#/modules/Synth/useCases/scheduleNote', () => ({
    scheduleNote: leaves.scheduleNote,
}));

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: () => 0,
}));

vi.mock('../../../repositories/offlineScheduler/automationScheduling', () => ({
    scheduleTrackAutomation: vi.fn(),
}));

vi.mock('../checkCancel', () => ({
    checkCancel: vi.fn(),
}));

const SECONDS_PER_PITCH = 0.125;
const BEATS_PER_PITCH = 0.25;
const HIGHEST_MIDI_PITCH = 127;

/** What the dedicated 808 drum-voice set plays, by note — the set live playback uses for kit 0. */
const DEDICATED_808_VOICES: Readonly<Record<number, string>> = {
    36: 'kick',
    37: 'rimshot',
    38: 'snare',
    39: 'clap',
    42: 'closed-hh',
    43: 'tom-low',
    46: 'open-hh',
    47: 'tom-mid',
    50: 'tom-high',
    56: 'cowbell',
    62: 'conga-high',
    63: 'conga-mid',
    64: 'conga-low',
    70: 'maracas',
    75: 'clave',
};

type DeviceCase = {
    label: string;
    type: string;
    parameterValues: Record<string, number>;
    kitIndex: number;
};

/** Variants carry the kit their catalog descriptor defaults to; a stored device may omit it. */
const DEVICE_CASES: readonly DeviceCase[] = [
    { label: 'base kit, kit 0', type: 'builtin-drum-kit', parameterValues: { kit: 0 }, kitIndex: 0 },
    { label: 'base kit, kit 1', type: 'builtin-drum-kit', parameterValues: { kit: 1 }, kitIndex: 1 },
    { label: 'base kit, kit 5', type: 'builtin-drum-kit', parameterValues: { kit: 5 }, kitIndex: 5 },
    { label: 'legacy drum-kit, kitId 0', type: 'drum-kit', parameterValues: { kitId: 0 }, kitIndex: 0 },
    { label: '808 variant', type: 'builtin-drum-machine-808', parameterValues: { kit: 0 }, kitIndex: 0 },
    { label: 'analog variant', type: 'builtin-drum-machine-analog', parameterValues: { kit: 1 }, kitIndex: 1 },
    {
        label: 'electronic variant',
        type: 'builtin-drum-machine-electronic',
        parameterValues: { kit: 2 },
        kitIndex: 2,
    },
    { label: 'acoustic variant', type: 'builtin-drum-machine-acoustic', parameterValues: { kit: 3 }, kitIndex: 3 },
    { label: '808 variant, kit absent', type: 'builtin-drum-machine-808', parameterValues: {}, kitIndex: 0 },
    { label: 'analog variant, kit absent', type: 'builtin-drum-machine-analog', parameterValues: {}, kitIndex: 0 },
    {
        label: 'electronic variant, kit absent',
        type: 'builtin-drum-machine-electronic',
        parameterValues: {},
        kitIndex: 0,
    },
    { label: 'acoustic variant, kit absent', type: 'builtin-drum-machine-acoustic', parameterValues: {}, kitIndex: 0 },
];

function expectedVoicesByPitch(kitIndex: number): Map<number, string> {
    const expected = new Map<number, string>();
    if (kitIndex === 0) {
        for (const [pitch, voice] of Object.entries(DEDICATED_808_VOICES)) {
            expected.set(Number(pitch), `drum-voice:${voice}`);
        }
        return expected;
    }
    const kit = getDrumKitByIndex(kitIndex);
    if (!kit) {
        return expected;
    }
    for (let pitch = 0; pitch <= HIGHEST_MIDI_PITCH; pitch++) {
        const voice = kit.voices.find(
            (candidate) => pitch >= candidate.pitchRange[0] && pitch <= candidate.pitchRange[1]
        );
        if (voice) {
            expected.set(pitch, `${kit.id}:${voice.name}`);
        }
    }
    return expected;
}

function pitchAt(startTime: number): number {
    return Math.round(startTime / SECONDS_PER_PITCH);
}

function factoryVoiceLabel(params: unknown, kitIndex: number): string {
    const kit = getDrumKitByIndex(kitIndex);
    const voice = kit?.voices.find((candidate) => candidate.params === params);
    return `${kit?.id}:${voice?.name}`;
}

function makeTrack(device: DeviceCase): Track {
    return {
        id: 'track-drums',
        name: 'Drums',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [
            {
                id: 'clip-1',
                trackId: 'track-drums',
                name: 'Pattern',
                startBeat: 0,
                endBeat: 40,
                type: 'midi',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#fff',
                locked: false,
                muted: false,
            },
        ],
        devices: [
            {
                id: 'drum-1',
                name: 'Drums',
                type: device.type,
                bypassed: false,
                parameterValues: device.parameterValues,
            },
        ],
        sends: [],
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
        midiFx: [],
    } satisfies Track;
}

function makeMidiWithEveryPitch(): NonNullable<MidiStoreState> {
    const notes = Array.from({ length: HIGHEST_MIDI_PITCH + 1 }, (_, pitch) => ({
        id: `note-${pitch}`,
        pitch,
        startBeat: pitch * BEATS_PER_PITCH,
        duration: 0.1,
        velocity: 100,
    }));
    return {
        probabilitySeed: 1,
        notesByClipId: { 'clip-1': notes },
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

/** Schedules a pattern holding every MIDI pitch and reports the voice each pitch reached. */
async function renderVoicesByPitch(device: DeviceCase): Promise<Map<number, string>> {
    const track = makeTrack(device);
    const midi = makeMidiWithEveryPitch();
    const pendingWorkletEvents: PendingWorkletEvent[] = [];
    const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>([[track.id, []]]);

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
            projectMidiEvents: (input) => {
                if (input.phase === 'sequencer-groove') {
                    return input.events;
                }
                return input.events.map((event) => ({
                    ...event,
                    startBeat: input.iterationStartBeat + event.startBeat,
                }));
            },
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
            processYeastMidi: (input) =>
                input.events.map((event) => ({ ...event, timePpq: event.timePpq ?? event.timeSamples })),
            resolveTempoAtBeat: ({ defaultTempo }) => defaultTempo,
            selectMidiEventProbability: () => true,
            projectChordPitch: ({ pitch }) => pitch,
            evaluateAutomationValue: () => null,
            resolveArticulationId: () => null,
        },
        pendingWorkletEvents,
        allTracks: [track],
        deviceEntriesByTrack,
        regionStartBeat: 0,
    });

    const reached = new Map<number, string>();
    for (const [, , voiceType, startTime] of leaves.scheduleDrumVoice.mock.calls) {
        reached.set(pitchAt(startTime as number), `drum-voice:${voiceType as string}`);
    }
    for (const [, , , startTime, , , params] of leaves.scheduleNote.mock.calls) {
        reached.set(pitchAt(startTime as number), factoryVoiceLabel(params, device.kitIndex));
    }
    return reached;
}

describe('offline render drum-kit parity', () => {
    beforeEach(() => {
        leaves.scheduleDrumVoice.mockClear();
        leaves.scheduleNote.mockClear();
    });

    it.each(DEVICE_CASES)('sounds the same notes through the same voices as live playback — $label', async (device) => {
        const reached = await renderVoicesByPitch(device);

        expect(Object.fromEntries(reached)).toEqual(Object.fromEntries(expectedVoicesByPitch(device.kitIndex)));
    });

    it('plays notes only the dedicated 808 set carries when a variant selects it', async () => {
        const reached = await renderVoicesByPitch({
            label: '808 variant',
            type: 'builtin-drum-machine-808',
            parameterValues: { kit: 0 },
            kitIndex: 0,
        });

        expect([37, 39, 43, 50, 56, 62, 63, 64, 70, 75].map((pitch) => reached.get(pitch))).toEqual([
            'drum-voice:rimshot',
            'drum-voice:clap',
            'drum-voice:tom-low',
            'drum-voice:tom-high',
            'drum-voice:cowbell',
            'drum-voice:conga-high',
            'drum-voice:conga-mid',
            'drum-voice:conga-low',
            'drum-voice:maracas',
            'drum-voice:clave',
        ]);
        expect(leaves.scheduleNote).not.toHaveBeenCalled();
    });
});
