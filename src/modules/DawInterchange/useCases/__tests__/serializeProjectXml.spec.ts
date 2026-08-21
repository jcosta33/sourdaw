import { describe, expect, it } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { parseProjectXml } from '../parseProjectXml';
import { type ProjectData, type ProjectTrack } from '../projectDataContract';
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

describe('serializeProjectXml — contentType mapping', () => {
    function serializeKind(kind: ProjectTrack['kind']): string {
        const project = buildProjectFixture();
        const base = project.arrangement.tracks[0];
        if (!base) {
            throw new Error('fixture missing base track');
        }
        project.arrangement.tracks = [{ ...base, id: 't0', name: 'T', kind, clips: [], color: '' }];
        return serializeProjectXml({ project, audioPathByBufferId: new Map() });
    }

    it('maps midi → contentType="notes"', () => {
        expect(serializeKind('midi')).toContain('contentType="notes"');
    });

    it('maps master → contentType="mix"', () => {
        expect(serializeKind('master')).toContain('contentType="mix"');
    });

    it('maps bus → contentType="audio"', () => {
        expect(serializeKind('bus')).toContain('contentType="audio"');
    });

    it('maps folder → contentType="tracks"', () => {
        expect(serializeKind('folder')).toContain('contentType="tracks"');
    });
});

describe('serializeProjectXml — number formatting', () => {
    it('emits a plain integer (no decimals) for whole numbers', () => {
        const project = buildProjectFixture();
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        // tempo 128 → "128", not "128.0"
        expect(xml).toContain('<Tempo value="128"/>');
    });

    it('rounds to 6 decimals and renders a whole-number duration without decimals', () => {
        const project = buildProjectFixture();
        // 1.2345678 has 7 decimals: rounding to 6 must drop the trailing 8.
        // A passthrough `String(value)` would emit "1.2345678" and fail here.
        const track = project.arrangement.tracks.find((t) => t.kind === 'audio')!;
        track.clips = [{ ...track.clips[0]!, startBeat: 1.2345678, endBeat: 3.2345678 }];
        const xml = serializeProjectXml({
            project,
            audioPathByBufferId: new Map([['buf-drums', 'x.wav']]),
        });
        expect(xml).toContain('time="1.234568"');
        expect(xml).not.toContain('time="1.2345678"');
        // endBeat - startBeat is exactly 2 → integer branch emits "2", not "2.0"
        expect(xml).toContain('duration="2"');
    });
});

describe('serializeProjectXml — audio clip without a resolved path', () => {
    it('emits a self-closing <Clip/> when the buffer has no mapped path', () => {
        const project = buildProjectFixture();
        // no entry for buf-drums in the map
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        // the audio clip with an unresolved path serializes as a self-closing tag
        expect(xml).toMatch(/<Clip[^>]*\/>/);
    });

    it('omits the Audio/File block when the audio clip has no bufferId', () => {
        const project = buildProjectFixture();
        const track = project.arrangement.tracks.find((t) => t.kind === 'audio')!;
        track.clips = [{ ...track.clips[0]!, bufferId: undefined }];
        const xml = serializeProjectXml({
            project,
            audioPathByBufferId: new Map([['buf-drums', 'x.wav']]),
        });
        expect(xml).not.toContain('<Audio>');
    });
});

describe('serializeProjectXml — track tree nesting', () => {
    it('nests child tracks under their parent in <Structure>', () => {
        const project = buildProjectFixture();
        const parent = project.arrangement.tracks[0]!;
        const child: ProjectTrack = {
            ...parent,
            id: 'child',
            name: 'Child',
            parentId: parent.id,
            clips: [],
        };
        project.arrangement.tracks = [parent, child];
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        // the child Track must appear before the parent's closing tag
        const parentOpen = xml.indexOf('id="track-audio-1"');
        const childOpen = xml.indexOf('id="child"');
        const parentClose = xml.indexOf('</Track>', parentOpen);
        expect(childOpen).toBeGreaterThan(parentOpen);
        expect(childOpen).toBeLessThan(parentClose);
    });

    it('orphaned tracks (parentId points to a non-existent track) become roots', () => {
        const project = buildProjectFixture();
        const orphan: ProjectTrack = {
            ...project.arrangement.tracks[0]!,
            id: 'orphan',
            name: 'Orphan',
            parentId: 'does-not-exist',
            clips: [],
        };
        project.arrangement.tracks = [orphan];
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        // orphan appears as a top-level Structure track (not nested)
        expect(xml).toContain('<Track id="orphan"');
    });
});

describe('serializeProjectXml — tempo / time-signature point lanes', () => {
    it('emits explicit tempo changes as RealPoints when the tempoMap has changes', () => {
        const project = buildProjectFixture();
        project.tempoMap = { changes: [{ beat: 4, tempo: 140 }] };
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<RealPoint time="4" value="140"/>');
    });

    it('emits a single initial tempo point when there are no tempo changes', () => {
        const project = buildProjectFixture();
        project.tempoMap = { changes: [] };
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<RealPoint time="0" value="128"/>');
    });

    it('emits explicit time-signature changes when the map has changes', () => {
        const project = buildProjectFixture();
        project.timeSignatureMap = { changes: [{ beat: 8, numerator: 6, denominator: 8 }] };
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<TimeSignaturePoint time="8" numerator="6" denominator="8"/>');
    });

    it('emits a single initial time-signature point when there are no changes', () => {
        const project = buildProjectFixture();
        project.timeSignatureMap = { changes: [] };
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        // Count the points lane specifically. `<TimeSignature .../>` is emitted
        // unconditionally inside <Transport> from the same fixture values, so a
        // bare substring match here passes even if this lane renders nothing.
        const points = xml.match(/<TimeSignaturePoint\b[^>]*\/>/g) ?? [];
        expect(points).toEqual(['<TimeSignaturePoint time="0" numerator="3" denominator="4"/>']);
    });
});

describe('serializeProjectXml — markers + devices + escaping', () => {
    it('omits the <Markers> block entirely when there are no markers', () => {
        const project = buildProjectFixture();
        project.markers = [];
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).not.toContain('<Markers>');
    });

    it('renders devices on a track channel when present', () => {
        const project = buildProjectFixture();
        const track = project.arrangement.tracks[0]!;
        track.devices = [
            { id: 'dev-1', type: 'Reverb', name: 'Hall', bypassed: true, parameterValues: {} },
            { id: 'dev-2', type: 'Delay', name: 'Tape', bypassed: false, parameterValues: {} },
        ];
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Devices>');
        expect(xml).toContain('deviceRole="Reverb" name="Hall" bypassed="true"');
        expect(xml).toContain('deviceRole="Delay" name="Tape" bypassed="false"');
    });

    it('escapes XML-special characters in names', () => {
        const project = buildProjectFixture();
        project.arrangement.tracks[0]!.name = 'A & B <C> "D"';
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('A &amp; B &lt;C&gt; &quot;D&quot;');
        // raw special chars must not leak unescaped inside the name attribute
        expect(xml).not.toContain('name="A & B');
    });

    it('clamps channel gain to the fader ceiling and normalises pan into [0,1]', () => {
        const project = buildProjectFixture();
        const track = project.arrangement.tracks[0]!;
        track.gain = 5; // clamps to the fader's +6 dB ceiling, not to unity
        track.pan = -2; // clamps to -1 → normalised (−1+1)/2 = 0
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain(`<Volume value="${String(Math.round(FADER_MAX_GAIN * 1_000_000) / 1_000_000)}"/>`);
        expect(xml).toContain('<Pan value="0"/>');
    });

    /**
     * `<Volume>` carries a linear amplitude, and the fader reaches
     * `FADER_MAX_GAIN`. Clamping the export at unity discarded every track's
     * make-up gain on the way out, silently — a round trip through interchange
     * flattened a +3.5 dB track to 0 dB with nothing said about it.
     */
    it('carries a gain above unity through the export instead of flattening it', () => {
        const project = buildProjectFixture();
        const track = project.arrangement.tracks[0]!;
        track.gain = 1.5;
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Volume value="1.5"/>');
    });

    it('normalises interior gain/pan values that no clamp saturates', () => {
        // The clamped case above sits at a fixed point of the pan normalisation:
        // pan −1 maps to 0 under both `(pan + 1) / 2` and a broken `pan + 1`.
        // Only an interior point separates them.
        const project = buildProjectFixture();
        const track = project.arrangement.tracks[0]!;
        track.gain = 0.5;
        track.pan = 0.5; // → (0.5 + 1) / 2 = 0.75
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Volume value="0.5"/>');
        expect(xml).toContain('<Pan value="0.75"/>');
    });
});
