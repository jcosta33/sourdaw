import { describe, expect, it } from 'vitest';

import { type ProjectData } from '../../../models/ProjectData';
import { parseProjectXml } from '../parseProjectXml';
import { serializeProjectXml } from '../serializeProjectXml';

function buildProjectFixture(): ProjectData {
    return {
        version: 1,
        meta: {
            name: 'Test Song',
            createdAt: 0,
            updatedAt: 0,
            keyRoot: 0,
            scaleName: 'chromatic',
            tuning: { name: 'Equal Temperament', frequencies: [] },
        },
        transport: {
            tempo: 128,
            timeSignatureNumerator: 3,
            timeSignatureDenominator: 4,
            loopStart: 0,
            loopEnd: 16,
            isLooping: false,
            metronomeEnabled: false,
            metronomeVolume: 0.5,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 0,
            countInEnabled: false,
            countInBars: 1,
            preRollEnabled: false,
            preRollBars: 1,
            masterGain: 0.8,
        },
        arrangement: {
            tracks: [
                {
                    id: 'track-audio-1',
                    name: 'Drums',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 0.7,
                    pan: 0,
                    color: '#ef4444',
                    clips: [
                        {
                            id: 'clip-1',
                            trackId: 'track-audio-1',
                            name: 'Drum Loop',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '',
                            locked: false,
                            muted: false,
                            bufferId: 'buf-drums',
                        },
                    ],
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
                    activeAlternativeId: 'track-audio-1-alt-default',
                    alternatives: [{ id: 'track-audio-1-alt-default', name: 'Alternative 1', clips: [] }],
                    vcaGroupId: null,
                    midiOutputTrackId: null,
                    followChordTrack: false,
                },
                {
                    id: 'track-midi-1',
                    name: 'Keys',
                    kind: 'midi',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    color: '#3b82f6',
                    clips: [
                        {
                            id: 'clip-2',
                            trackId: 'track-midi-1',
                            name: 'Chord Stab',
                            startBeat: 4,
                            endBeat: 8,
                            type: 'midi',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '',
                            locked: false,
                            muted: false,
                        },
                    ],
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
                    activeAlternativeId: 'track-midi-1-alt-default',
                    alternatives: [{ id: 'track-midi-1-alt-default', name: 'Alternative 1', clips: [] }],
                    vcaGroupId: null,
                    midiOutputTrackId: null,
                    followChordTrack: false,
                },
            ],
        },
        automation: { lanes: [] },
        midi: {
            notesByClipId: {
                'clip-2': [
                    {
                        id: 'note-1',
                        pitch: 60,
                        startBeat: 0,
                        duration: 1,
                        velocity: Math.round(0.8 * 127),
                        probability: 100,
                        pressure: 0,
                        slide: 0,
                        pitchBend: 0,
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        },
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        markers: [{ id: 'marker-1', beat: 8, name: 'Verse', color: '#f59e0b' }],
        history: { checkpoints: [] },
    };
}

describe('serializeProjectXml + parseProjectXml round-trip', () => {
    it('serializes tracks, clips, notes, tempo, time-sig and markers in a shape the importer can parse back', () => {
        const project = buildProjectFixture();
        const audioPathByBufferId = new Map<string, string>([['buf-drums', 'audio/buf-drums.wav']]);

        const xml = serializeProjectXml({ project, audioPathByBufferId });
        const parsed = parseProjectXml(xml);

        expect(parsed.initialTempo).toBe(128);
        expect(parsed.initialTimeSignature).toEqual({ numerator: 3, denominator: 4 });
        expect(parsed.tracks).toHaveLength(2);

        const drumTrack = parsed.tracks.find((t) => t.name === 'Drums');
        expect(drumTrack).toBeDefined();
        expect(drumTrack?.kind).toBe('audio');
        expect(drumTrack?.clips).toHaveLength(1);
        const drumClip = drumTrack?.clips[0];
        expect(drumClip?.type).toBe('audio');
        expect(drumClip?.startBeat).toBe(0);
        expect(drumClip?.endBeat).toBe(4);
        expect(drumClip?.audioAssetPath).toBe('audio/buf-drums.wav');

        const keysTrack = parsed.tracks.find((t) => t.name === 'Keys');
        expect(keysTrack).toBeDefined();
        expect(keysTrack?.kind).toBe('midi');
        const midiClip = keysTrack?.clips[0];
        expect(midiClip?.type).toBe('midi');
        expect(midiClip?.startBeat).toBe(4);
        expect(midiClip?.endBeat).toBe(8);
        expect(midiClip?.notes).toHaveLength(1);
        expect(midiClip?.notes?.[0]).toMatchObject({ pitch: 60, startBeat: 0, duration: 1 });

        expect(parsed.markers).toEqual([{ beat: 8, name: 'Verse' }]);
    });
});
