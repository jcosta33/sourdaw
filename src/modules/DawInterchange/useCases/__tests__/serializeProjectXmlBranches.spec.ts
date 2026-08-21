import { describe, expect, it } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type ProjectData } from '../projectDataContract';
import { serializeProjectXml } from '../serializeProjectXml';

/**
 * Branch specs for serializeProjectXml's private helpers: escapeXml,
 * contentTypeForKind, formatNumber, channel gain/pan clamping, velocity
 * normalization, empty-audio-path fallback, tempo/timeSignature maps.
 * The existing spec only does one round-trip with plain ASCII.
 */

function buildTrack(
    overrides: Partial<ProjectData['arrangement']['tracks'][number]> = {}
): ProjectData['arrangement']['tracks'][number] {
    return {
        id: 't1',
        name: 'Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#999999',
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
        activeAlternativeId: 't1-alt-default',
        alternatives: [{ id: 't1-alt-default', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

function buildProject(
    tracks: ProjectData['arrangement']['tracks'][number][],
    overrides: Partial<ProjectData> = {}
): ProjectData {
    return {
        version: 1,
        meta: {
            name: 'Test',
            createdAt: 0,
            updatedAt: 0,
            keyRoot: 0,
            scaleName: 'chromatic',
            tuning: { name: 'ET', frequencies: [] },
        },
        transport: {
            tempo: 120,
            timeSignatureNumerator: 4,
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
        arrangement: { tracks },
        automation: { lanes: [] },
        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        markers: [],
        history: { checkpoints: [] },
        ...overrides,
    };
}

describe('serializeProjectXml — escapeXml', () => {
    it('escapes ampersands in track names', () => {
        const project = buildProject([buildTrack({ name: 'A & B' })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('A &amp; B');
        expect(xml).not.toContain('A & B');
    });

    it('escapes angle brackets in track names', () => {
        const project = buildProject([buildTrack({ name: 'x<y>z' })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('x&lt;y&gt;z');
    });

    it('escapes quotes in marker names', () => {
        const project = buildProject([], { markers: [{ id: 'm1', beat: 0, name: 'say "hi"', color: '#fff' }] });
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('say &quot;hi&quot;');
    });
});

describe('serializeProjectXml — contentTypeForKind', () => {
    it('maps audio tracks to contentType="audio"', () => {
        const project = buildProject([buildTrack({ id: 'audio-t', kind: 'audio' })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('contentType="audio"');
    });

    it('maps midi tracks to contentType="notes"', () => {
        const project = buildProject([buildTrack({ id: 'midi-t', kind: 'midi' })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('contentType="notes"');
    });

    it('maps master tracks to contentType="mix"', () => {
        const project = buildProject([buildTrack({ id: 'master-t', kind: 'master' })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('contentType="mix"');
    });

    it('maps bus tracks to contentType="audio"', () => {
        const project = buildProject([buildTrack({ id: 'bus-t', kind: 'bus' })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('contentType="audio"');
    });

    it('maps unknown track kinds to contentType="tracks"', () => {
        const project = buildProject([buildTrack({ id: 'unk-t', kind: 'unknown' as never })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('contentType="tracks"');
    });
});

describe('serializeProjectXml — formatNumber', () => {
    it('serializes integer tempo without decimal point', () => {
        const project = buildProject([], {});
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Tempo value="120"/>');
    });

    it('serializes NaN tempo as "0"', () => {
        const project = buildProject([], { transport: { ...buildProject([]).transport, tempo: Number.NaN } });
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Tempo value="0"/>');
    });

    it('serializes Infinity tempo as "0"', () => {
        const project = buildProject([], {
            transport: { ...buildProject([]).transport, tempo: Number.POSITIVE_INFINITY },
        });
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Tempo value="0"/>');
    });

    it('serializes fractional tempo with up to 6 decimal places', () => {
        const project = buildProject([], { transport: { ...buildProject([]).transport, tempo: 128.5 } });
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Tempo value="128.5"/>');
    });
});

describe('serializeProjectXml — channel gain/pan clamping', () => {
    it('clamps gain above the fader ceiling down to it', () => {
        const project = buildProject([buildTrack({ gain: 5 })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain(`<Volume value="${String(Math.round(FADER_MAX_GAIN * 1_000_000) / 1_000_000)}"/>`);
    });

    it('carries a gain above unity through unflattened', () => {
        const project = buildProject([buildTrack({ gain: 1.5 })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Volume value="1.5"/>');
    });

    it('clamps negative gain to 0', () => {
        const project = buildProject([buildTrack({ gain: -0.5 })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Volume value="0"/>');
    });

    it('normalizes pan=-1 to 0.0 (full left)', () => {
        const project = buildProject([buildTrack({ pan: -1 })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Pan value="0"/>');
    });

    it('normalizes pan=0 to 0.5 (center)', () => {
        const project = buildProject([buildTrack({ pan: 0 })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Pan value="0.5"/>');
    });

    it('normalizes pan=1 to 1.0 (full right)', () => {
        const project = buildProject([buildTrack({ pan: 1 })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Pan value="1"/>');
    });

    it('clamps pan > 1 to 1.0 before normalizing', () => {
        const project = buildProject([buildTrack({ pan: 3 })]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('<Pan value="1"/>');
    });
});

describe('serializeProjectXml — velocity normalization', () => {
    it('normalizes MIDI velocity 127 to 1.0', () => {
        const project = buildProject([
            buildTrack({
                kind: 'midi',
                clips: [
                    {
                        id: 'c1',
                        trackId: 't1',
                        name: 'clip',
                        startBeat: 0,
                        endBeat: 1,
                        type: 'midi',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '',
                        locked: false,
                        muted: false,
                    },
                ],
            }),
        ]);
        project.midi.notesByClipId = {
            c1: [
                {
                    id: 'n1',
                    pitch: 60,
                    startBeat: 0,
                    duration: 1,
                    velocity: 127,
                    probability: 100,
                    pressure: 0,
                    slide: 0,
                    pitchBend: 0,
                },
            ],
        };
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('vel="1"');
    });

    it('normalizes MIDI velocity 0 to 0.0', () => {
        const project = buildProject([
            buildTrack({
                kind: 'midi',
                clips: [
                    {
                        id: 'c1',
                        trackId: 't1',
                        name: 'clip',
                        startBeat: 0,
                        endBeat: 1,
                        type: 'midi',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '',
                        locked: false,
                        muted: false,
                    },
                ],
            }),
        ]);
        project.midi.notesByClipId = {
            c1: [
                {
                    id: 'n1',
                    pitch: 60,
                    startBeat: 0,
                    duration: 1,
                    velocity: 0,
                    probability: 100,
                    pressure: 0,
                    slide: 0,
                    pitchBend: 0,
                },
            ],
        };
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('vel="0"');
    });
});

describe('serializeProjectXml — audio clip without buffer path', () => {
    it('emits a self-closing Clip when bufferId has no matching path', () => {
        const project = buildProject([
            buildTrack({
                clips: [
                    {
                        id: 'c1',
                        trackId: 't1',
                        name: 'orphan',
                        startBeat: 0,
                        endBeat: 2,
                        type: 'audio',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '',
                        locked: false,
                        muted: false,
                        bufferId: 'missing-buf',
                    },
                ],
            }),
        ]);
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        // No <Audio> block; the clip is self-closing.
        expect(xml).toContain('/>');
        expect(xml).not.toContain('<Audio>');
    });
});

describe('serializeProjectXml — tempo map with changes', () => {
    it('renders explicit tempo changes when tempoMap is populated', () => {
        const base = buildProject([]);
        const project: ProjectData = {
            ...base,
            tempoMap: {
                changes: [
                    { beat: 0, tempo: 120 },
                    { beat: 8, tempo: 140 },
                ],
            },
        };
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('time="0" value="120"');
        expect(xml).toContain('time="8" value="140"');
        // The fallback single-point line (time="0" value=<transport.tempo>) should not appear.
        expect(xml).not.toContain('value="120"/>\n            </Points>');
    });
});

describe('serializeProjectXml — time signature map with changes', () => {
    it('renders explicit time signature changes when timeSignatureMap is populated', () => {
        const base = buildProject([]);
        const project: ProjectData = {
            ...base,
            timeSignatureMap: {
                changes: [
                    { beat: 0, numerator: 4, denominator: 4 },
                    { beat: 16, numerator: 6, denominator: 8 },
                ],
            },
        };
        const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
        expect(xml).toContain('numerator="6" denominator="8"');
    });
});
