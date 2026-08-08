/**
 * What a DAWproject export→import round-trip must preserve about track
 * identity and routing (audits M-261, M-262).
 *
 * These go through the real serializer, the real parser and the real mapper —
 * not through either half's own contract — because both defects live in the
 * seam. Each half's existing unit specs pass today.
 */

import { describe, expect, it } from 'vitest';

import { mapToProjectData } from '../mapToProjectData';
import { parseProjectXml } from '../parseProjectXml';
import { type ProjectData } from '../projectDataContract';
import { serializeProjectXml } from '../serializeProjectXml';

type Track = ProjectData['arrangement']['tracks'][number];

function buildTrack(overrides: Partial<Track> & Pick<Track, 'id'>): Track {
    return {
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
        activeAlternativeId: `${overrides.id}-alt-default`,
        alternatives: [{ id: `${overrides.id}-alt-default`, name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

function buildProject(tracks: Track[]): ProjectData {
    return {
        version: 1,
        meta: {
            name: 'Identity',
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
    };
}

function roundTrip(project: ProjectData): ProjectData {
    const xml = serializeProjectXml({ project, audioPathByBufferId: new Map() });
    const parsed = {
        // metadata.xml is a separate member of the archive; the mapper takes
        // both halves, so the round-trip supplies the same title the exporter
        // would have written.
        meta: { title: project.meta.name, artist: '', comment: '' },
        audioAssets: new Map<string, Uint8Array>(),
        ...parseProjectXml(xml),
    };
    return mapToProjectData({ parsed, bufferIdsByPath: new Map(), fileName: 'identity.dawproject' });
}

/**
 * The importer mints fresh track ids, so identity across the seam is carried by
 * name. Every fixture below uses distinct names for that reason.
 */
function trackNamed(project: ProjectData, name: string): Track {
    const found = project.arrangement.tracks.find((track) => track.name === name);
    if (!found) {
        throw new Error(`Imported project has no track named "${name}"`);
    }
    return found;
}

function kindOf(project: ProjectData, name: string): string {
    return trackNamed(project, name).kind;
}

describe('DAWproject round-trip — track kinds (audit M-261)', () => {
    it('brings a master track back as a master track, not as audio', () => {
        const returned = roundTrip(
            buildProject([
                buildTrack({ id: 'mix-bus', name: 'Mix Bus', kind: 'master', outputId: 'hw_out' }),
                buildTrack({ id: 'gtr', name: 'Guitar', kind: 'audio', outputId: 'mix-bus' }),
            ])
        );

        expect(kindOf(returned, 'Mix Bus')).toBe('master');
        // Pin the negative: the fix must not promote every track to master.
        expect(kindOf(returned, 'Guitar')).toBe('audio');
    });

    it('brings a bus back as a bus, not as an audio track', () => {
        const returned = roundTrip(
            buildProject([
                buildTrack({ id: 'the-master', name: 'Master', kind: 'master', outputId: 'hw_out' }),
                buildTrack({ id: 'drum-bus', name: 'Drum Bus', kind: 'bus', outputId: 'the-master' }),
                buildTrack({ id: 'kick', name: 'Kick', kind: 'audio', outputId: 'drum-bus' }),
            ])
        );

        expect(kindOf(returned, 'Drum Bus')).toBe('bus');
        // Pin the negative: the fix must not turn every track into a bus.
        expect(kindOf(returned, 'Kick')).toBe('audio');
    });

    it('leaves an ordinary MIDI track alone', () => {
        const returned = roundTrip(buildProject([buildTrack({ id: 'keys', name: 'Keys', kind: 'midi' })]));

        expect(kindOf(returned, 'Keys')).toBe('midi');
    });
});

describe('DAWproject round-trip — output routing (audit M-262)', () => {
    it('routes every track to a master track that exists in the imported project', () => {
        const returned = roundTrip(
            buildProject([
                // Named, not 'Master', and with a foreign id: nothing about a
                // foreign DAW's master channel matches the literal the importer
                // hardcoded.
                buildTrack({ id: 'bitwig-master-42', name: 'Main Out', kind: 'master', outputId: 'hw_out' }),
                buildTrack({ id: 'vox', name: 'Vocals', kind: 'audio' }),
                buildTrack({ id: 'bass', name: 'Bass', kind: 'audio' }),
            ])
        );

        const ids = new Set(returned.arrangement.tracks.map((track) => track.id));
        const master = trackNamed(returned, 'Main Out');
        expect(master.kind).toBe('master');
        expect(master.outputId).toBe('hw_out');
        // Exactly one master: the importer must not have synthesized a second.
        expect(returned.arrangement.tracks.filter((track) => track.kind === 'master')).toHaveLength(1);

        for (const name of ['Vocals', 'Bass']) {
            const track = trackNamed(returned, name);
            expect(ids.has(track.outputId)).toBe(true);
            expect(track.outputId).toBe(master.id);
        }
    });

    it('still routes to the synthesized master when the file carries none', () => {
        const returned = roundTrip(buildProject([buildTrack({ id: 'vox', name: 'Vocals', kind: 'audio' })]));

        const master = returned.arrangement.tracks.find((track) => track.kind === 'master');
        expect(master?.id).toBe('master');
        expect(trackNamed(returned, 'Vocals').outputId).toBe('master');
    });
});
