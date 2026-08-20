import { describe, it, expect } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type DawProjectParseResult } from '../dawProjectTypes';
import { mapToProjectData } from '../mapToProjectData';

function minimalParsed(overrides: Partial<DawProjectParseResult> = {}): DawProjectParseResult {
    return {
        meta: { title: 'Test', artist: '', comment: '' },
        initialTempo: 120,
        initialTimeSignature: { numerator: 4, denominator: 4 },
        tempoChanges: [],
        timeSignatureChanges: [],
        tracks: [],
        markers: [],
        audioAssets: new Map(),
        ...overrides,
    };
}

describe('mapToProjectData — top-level structure', () => {
    it('maps the transport tempo and time signature from parsed input', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({ initialTempo: 140, initialTimeSignature: { numerator: 6, denominator: 8 } }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        expect(data.transport.tempo).toBe(140);
        expect(data.transport.timeSignatureNumerator).toBe(6);
        expect(data.transport.timeSignatureDenominator).toBe(8);
    });

    it('uses the meta title as the project name when present', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({ meta: { title: 'My Song', artist: '', comment: '' } }),
            bufferIdsByPath: new Map(),
            fileName: 'file.dawproject',
        });
        expect(data.meta.name).toBe('My Song');
    });

    it('falls back to the filename (without extension) when the title is empty', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({ meta: { title: '  ', artist: '', comment: '' } }),
            bufferIdsByPath: new Map(),
            fileName: 'Untitled.dawproject',
        });
        expect(data.meta.name).toBe('Untitled');
    });

    it('falls back to "Imported Project" when both title and filename are empty', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({ meta: { title: '', artist: '', comment: '' } }),
            bufferIdsByPath: new Map(),
            fileName: '',
        });
        expect(data.meta.name).toBe('Imported Project');
    });

    it('produces a 128-entry equal-temperament tuning table with correct semitone slope', () => {
        const data = mapToProjectData({
            parsed: minimalParsed(),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        expect(data.meta.tuning.frequencies).toHaveLength(128);
        // MIDI note 69 = A4 = 440 Hz (the anchor).
        expect(data.meta.tuning.frequencies[69]).toBeCloseTo(440, 1);
        // Index 57 = A3 = 220 Hz (one octave below). Index 81 = A5 = 880 (one octave above).
        // These pin the /12 semitone slope, not just the fixed point.
        expect(data.meta.tuning.frequencies[57]).toBeCloseTo(220, 1);
        expect(data.meta.tuning.frequencies[81]).toBeCloseTo(880, 1);
    });
});

describe('mapToProjectData — master track injection', () => {
    it('injects a master track when none exists in the parsed input', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't1',
                        name: 'T1',
                        kind: 'midi',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const master = data.arrangement.tracks.find((track) => track.kind === 'master');
        expect(master).toBeDefined();
        expect(master!.id).toBe('master');
        expect(master!.outputId).toBe('hw_out');
    });

    it('does not inject a master track when one already exists', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 'custom-master',
                        name: 'Master',
                        kind: 'master',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const masters = data.arrangement.tracks.filter((track) => track.kind === 'master');
        expect(masters).toHaveLength(1);
        expect(masters[0]!.id).toBe('custom-master');
    });
});

describe('mapToProjectData — clip mapping', () => {
    it('maps an audio clip with its buffer id resolved from the path map', () => {
        const buffers = new Map([['assets/kick.wav', 'buf-kick']]);
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't1',
                        name: 'T1',
                        kind: 'audio',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [
                            {
                                id: 'c1',
                                name: 'Kick',
                                startBeat: 0,
                                endBeat: 4,
                                type: 'audio',
                                audioAssetPath: 'assets/kick.wav',
                            },
                        ],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: buffers,
            fileName: 'test.dawproject',
        });
        const clip = data.arrangement.tracks.find((track) => track.id === 't1')!.clips[0]!;
        expect(clip.type).toBe('audio');
        expect(clip.bufferId).toBe('buf-kick');
    });

    it('leaves bufferId undefined when the audio path is not in the map', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't1',
                        name: 'T1',
                        kind: 'audio',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [
                            {
                                id: 'c1',
                                name: 'Missing',
                                startBeat: 0,
                                endBeat: 4,
                                type: 'audio',
                                audioAssetPath: 'gone.wav',
                            },
                        ],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const clip = data.arrangement.tracks.find((track) => track.id === 't1')!.clips[0]!;
        expect(clip.bufferId).toBeUndefined();
    });

    it('maps a MIDI clip and populates notesByClipId with default probability/pressure', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't1',
                        name: 'T1',
                        kind: 'midi',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [
                            {
                                id: 'c1',
                                name: 'MIDI',
                                startBeat: 0,
                                endBeat: 4,
                                type: 'midi',
                                notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
                            },
                        ],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const notes = data.midi.notesByClipId.c1!;
        expect(notes).toHaveLength(1);
        expect(notes[0]!.pitch).toBe(60);
        expect(notes[0]!.velocity).toBe(90);
        // Default MPE fields.
        expect(notes[0]!.probability).toBe(100);
        expect(notes[0]!.pressure).toBe(0);
    });
});

describe('mapToProjectData — device normalization', () => {
    it('passes through known builtin device types', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't1',
                        name: 'T1',
                        kind: 'midi',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: ['builtin-synth', 'builtin-reverb'],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const track = data.arrangement.tracks.find((track) => track.id === 't1')!;
        expect(track.devices).toHaveLength(2);
        expect(track.devices[0]!.type).toBe('builtin-synth');
        expect(track.devices[1]!.type).toBe('builtin-reverb');
    });

    it('normalizes unknown device types to a default gain device', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't1',
                        name: 'T1',
                        kind: 'audio',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: ['mystery-plugin'],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const track = data.arrangement.tracks.find((track) => track.id === 't1')!;
        expect(track.devices).toHaveLength(1);
        expect(track.devices[0]!.type).toBe('builtin-gain');
        expect(track.devices[0]!.name).toBe('mystery-plugin');
    });

    it('injects a default synth for a midi track with no devices', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't1',
                        name: 'T1',
                        kind: 'midi',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const track = data.arrangement.tracks.find((track) => track.id === 't1')!;
        expect(track.devices).toHaveLength(1);
        expect(track.devices[0]!.type).toBe('builtin-synth');
        expect(track.devices[0]!.name).toBe('Synth');
    });
});

describe('mapToProjectData — track routing and solo flags', () => {
    it('routes non-master tracks to the master output', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't1',
                        name: 'T1',
                        kind: 'audio',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const track = data.arrangement.tracks.find((track) => track.id === 't1')!;
        expect(track.outputId).toBe('master');
    });

    it('routes an explicit master track to the hardware output', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 'my-master',
                        name: 'Master',
                        kind: 'master',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const master = data.arrangement.tracks.find((track) => track.kind === 'master')!;
        expect(master.outputId).toBe('hw_out');
    });

    it('sets soloSafe true for bus tracks, false otherwise', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 'bus-1',
                        name: 'Bus',
                        kind: 'bus',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: [],
                    },
                    {
                        id: 't1',
                        name: 'T1',
                        kind: 'audio',
                        color: '',
                        parentId: null,
                        volume: 0.8,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const bus = data.arrangement.tracks.find((track) => track.id === 'bus-1')!;
        const audio = data.arrangement.tracks.find((track) => track.id === 't1')!;
        expect(bus.soloSafe).toBe(true);
        expect(audio.soloSafe).toBe(false);
    });
});

describe('mapToProjectData — tempo/timeSignature maps and markers', () => {
    it('maps tempo changes when present', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tempoChanges: [
                    { beat: 0, tempo: 120 },
                    { beat: 4, tempo: 140 },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        expect(data.tempoMap).toBeDefined();
        expect(data.tempoMap!.changes).toHaveLength(2);
    });

    it('leaves tempoMap undefined when there are no tempo changes', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({ tempoChanges: [] }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        expect(data.tempoMap).toBeUndefined();
    });

    it('maps time-signature changes when present', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                timeSignatureChanges: [
                    { beat: 0, numerator: 4, denominator: 4 },
                    { beat: 8, numerator: 3, denominator: 4 },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        expect(data.timeSignatureMap).toBeDefined();
        expect(data.timeSignatureMap!.changes).toHaveLength(2);
    });

    it('leaves timeSignatureMap undefined when there are no time-signature changes', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({ timeSignatureChanges: [] }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        expect(data.timeSignatureMap).toBeUndefined();
    });

    it('maps markers with generated ids and the default color', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                markers: [
                    { beat: 0, name: 'Intro' },
                    { beat: 16, name: 'Verse' },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        expect(data.markers).toHaveLength(2);
        expect(data.markers[0]!.name).toBe('Intro');
        expect(data.markers[0]!.beat).toBe(0);
        expect(data.markers[0]!.color).toBe('#f59e0b');
    });
});

describe('mapToProjectData — gain/pan clamping', () => {
    it('clamps track volume to the fader ceiling and pan into [-1, 1]', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't1',
                        name: 'T1',
                        kind: 'audio',
                        color: '',
                        parentId: null,
                        volume: 2.5,
                        pan: -5,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const track = data.arrangement.tracks.find((track) => track.id === 't1')!;
        expect(track.gain).toBe(FADER_MAX_GAIN);
        expect(track.pan).toBe(-1);
    });

    /**
     * The import twin of `serializeProjectXml`'s export clamp. Pinned at unity
     * it flattened make-up gain on the way in, so a round trip lost it even
     * once the export carried it out.
     */
    it('carries an imported volume above unity through instead of flattening it', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't3',
                        name: 'T3',
                        kind: 'audio',
                        color: '',
                        parentId: null,
                        volume: 1.5,
                        pan: 0,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        expect(data.arrangement.tracks.find((track) => track.id === 't3')!.gain).toBe(1.5);
    });

    it('clamps negative volume to 0 and pan above 1 to 1', () => {
        const data = mapToProjectData({
            parsed: minimalParsed({
                tracks: [
                    {
                        id: 't2',
                        name: 'T2',
                        kind: 'audio',
                        color: '',
                        parentId: null,
                        volume: -3,
                        pan: 7,
                        mute: false,
                        solo: false,
                        clips: [],
                        deviceTypes: [],
                    },
                ],
            }),
            bufferIdsByPath: new Map(),
            fileName: 'test.dawproject',
        });
        const track = data.arrangement.tracks.find((track) => track.id === 't2')!;
        expect(track.gain).toBe(0);
        expect(track.pan).toBe(1);
    });
});
