import { describe, expect, it } from 'vitest';

import { createTrack, normalizeTrack } from '#/modules/Arrangement/useCases';
import { getToasterPresetDeviceState } from '#/modules/Toaster/useCases';

import { getCanonicalTrackRole } from '../getCanonicalTrackRole';
import { hydrateArrangementTracks } from '../projectPersistence/fileIO/hydrateArrangementTracks';
import { hydrateProjectMidi } from '../projectPersistence/fileIO/hydrateProjectMidi';
import { serializeArrangementTracks } from '../projectPersistence/fileIO/serializeArrangementTracks';

type Input = Parameters<typeof getCanonicalTrackRole>[0];
function input(name = 'Track 1'): Input {
    return { track: createTrack({ id: 't', name, kind: 'midi' }), trackRoles: [], notesByClipId: {} };
}
function content(pitches: number[], parameters: Record<string, number> = { kit: 0 }): Input {
    const result = input();
    result.track = {
        ...result.track,
        devices: [{ type: 'builtin-drum-kit', parameterValues: parameters }],
        clips: [{ id: 'c', type: 'midi', notes: pitches.map((pitch) => ({ pitch })) }],
    };
    return result;
}

function hydratedLegacyDrumInput(pitch: number): Input {
    const clipId = 'legacy-clip';
    const runtimeTrack = normalizeTrack({
        id: 'legacy-drums',
        name: '',
        kind: 'midi',
        clips: [
            {
                id: clipId,
                trackId: 'legacy-drums',
                name: 'Legacy pattern',
                startBeat: 0,
                endBeat: 4,
                type: 'midi',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '',
                locked: false,
                muted: false,
            },
        ],
        devices: [
            {
                id: 'legacy-kit',
                name: 'Legacy drum kit',
                type: 'drum-kit',
                bypassed: false,
                parameterValues: { kitId: 0 },
            },
        ],
    });
    const notesByClipId = hydrateProjectMidi({
        notesByClipId: {
            [clipId]: [{ id: 'legacy-note', pitch, startBeat: 0, duration: 1, velocity: 100 }],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    }).notesByClipId;
    const [track] = hydrateArrangementTracks(serializeArrangementTracks([runtimeTrack], notesByClipId));
    if (!track) {
        throw new Error('Expected the serialized legacy drum track to hydrate');
    }
    return { track, trackRoles: [], notesByClipId };
}

describe('canonical track roles', () => {
    it('uses authored canonical values before names, structural kinds and content, preserving legacy text', () => {
        const source = content([36]);
        source.track = { ...source.track, name: 'Snare', kind: 'master' };
        source.trackRoles = [
            { trackId: 't', role: 'pad' },
            { trackId: 't', role: 'pad' },
        ];
        const before = structuredClone(source);
        expect(getCanonicalTrackRole(source)).toEqual({ role: 'pad', source: 'authored', evidence: 'authored-role' });
        expect(source).toEqual(before);
    });
    it.each([
        { roles: ['kick', 'snare'], evidence: 'conflicting-authored-roles' },
        { roles: ['legacy lead', 'kick'], evidence: 'unsupported-authored-role' },
    ])('blocks fallback for $evidence', ({ roles, evidence }) => {
        const source = content([36]);
        source.trackRoles = roles.map((role) => ({ trackId: 't', role }));
        expect(getCanonicalTrackRole(source)).toEqual({ role: 'unknown', source: 'authored', evidence });
    });
    it.each(['Vocal', 'Vocals', 'Vox'])(
        'keeps authored and structural authority above bare vocal names: %s',
        (name) => {
            const explicit = input(name);
            explicit.trackRoles = [{ trackId: 't', role: 'pad' }];
            expect(getCanonicalTrackRole(explicit)).toEqual({
                role: 'pad',
                source: 'authored',
                evidence: 'authored-role',
            });

            const conflicting = input(name);
            conflicting.trackRoles = [
                { trackId: 't', role: 'kick' },
                { trackId: 't', role: 'snare' },
            ];
            expect(getCanonicalTrackRole(conflicting)).toEqual({
                role: 'unknown',
                source: 'authored',
                evidence: 'conflicting-authored-roles',
            });

            for (const kind of ['bus', 'master'] as const) {
                const structural = input(name);
                structural.track = { ...structural.track, kind };
                expect(getCanonicalTrackRole(structural)).toEqual({
                    role: kind,
                    source: 'name-tags',
                    evidence: 'structural-kind',
                });
            }
        }
    );
    it.each([
        ['Kick 01', 'kick'],
        ['SNARE top', 'snare'],
        ['Hi-hat', 'hi-hat'],
        ['Floor Tom', 'tom'],
        ['Ride Cymbal', 'cymbal'],
        ['Percussion', 'percussion'],
        ['Drums', 'drums'],
        ['Bass DI', 'bass'],
        ['Lead Vocal', 'lead vocal'],
        ['Backing Vocals', 'backing vocal'],
        ['Guitar', 'guitar'],
        ['Keys', 'keys'],
        ['Synth', 'synth'],
        ['Pad', 'pad'],
        ['FX', 'fx'],
    ])('recognizes whole-name tokens in %s', (name, role) => {
        expect(getCanonicalTrackRole(input(name))).toMatchObject({ role, source: 'name-tags' });
    });
    it.each(['Lead Vocal Backing Vocal', 'Kick Vocal', 'Bass and Guitar'])(
        'refuses conflicting name evidence: %s',
        (name) => {
            expect(getCanonicalTrackRole(input(name))).toEqual({
                role: 'unknown',
                source: 'name-tags',
                evidence: 'conflicting-name-tags',
            });
        }
    );
    it.each([
        { name: 'Kick Drum', role: 'kick', evidence: 'resolved-name-tags' },
        { name: 'Snare Drum', role: 'snare', evidence: 'resolved-name-tags' },
        { name: 'Tom Drums', role: 'tom', evidence: 'resolved-name-tags' },
        { name: 'Bass Drum', role: 'kick', evidence: 'resolved-name-tags' },
        { name: 'Bass Drums', role: 'kick', evidence: 'resolved-name-tags' },
        { name: 'Synth Pad', role: 'pad', evidence: 'resolved-name-tags' },
        { name: 'Synth Bass', role: 'bass', evidence: 'resolved-name-tags' },
        { name: 'Vocals', role: 'lead vocal', evidence: 'resolved-name-tags' },
        { name: 'Vocal', role: 'lead vocal', evidence: 'resolved-name-tags' },
        { name: 'Vox', role: 'lead vocal', evidence: 'resolved-name-tags' },
        { name: 'Lead Vox', role: 'lead vocal', evidence: 'resolved-name-tags' },
        { name: 'Backing Vox', role: 'backing vocal', evidence: 'resolved-name-tags' },
        { name: 'BGV', role: 'backing vocal', evidence: 'name-tokens' },
        { name: 'Backing Vocals', role: 'backing vocal', evidence: 'name-tokens' },
        // "Bass guitar" is the bass by studio convention, so it is not a bass-versus-guitar conflict.
        { name: 'Bass Guitar', role: 'bass', evidence: 'resolved-name-tags' },
        { name: 'Bass-Guitar', role: 'bass', evidence: 'resolved-name-tags' },
        { name: 'Bass and Guitar', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Bass / Guitar', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Bass & Guitar', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Guitar Bass', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Drums', role: 'drums', evidence: 'name-tokens' },
        { name: 'Synth', role: 'synth', evidence: 'name-tokens' },
        { name: 'Kick', role: 'kick', evidence: 'name-tokens' },
    ] as const)(
        'resolves compound and bare vocal track names to a canonical role: $name',
        ({ name, role, evidence }) => {
            expect(getCanonicalTrackRole(input(name))).toEqual({ role, source: 'name-tags', evidence });
        }
    );
    it.each([
        { name: 'Kick-Drum', role: 'kick', evidence: 'resolved-name-tags' },
        { name: 'Bass_Drum', role: 'kick', evidence: 'resolved-name-tags' },
        { name: 'Bass Synth', role: 'bass', evidence: 'resolved-name-tags' },
        { name: 'Pad Synth', role: 'pad', evidence: 'resolved-name-tags' },
        { name: 'Bass & Drums', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Drums and Bass', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Bass + Drums', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Bass Drum & Bass', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Bass-Drum + Bass', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Bass_Drum / Bass', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Bass / Bass Drum', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Bass Drum and Bass', role: 'unknown', evidence: 'conflicting-name-tags' },
        // Only drum-family evidence: no adjacency rule picks a role, so the track is drums.
        { name: 'Drums & Perc', role: 'drums', evidence: 'resolved-name-tags' },
        { name: 'Synth & Guitar', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Synth Pad, Synth', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Pad Synth + Synth', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Drum Bass', role: 'unknown', evidence: 'conflicting-name-tags' },
    ] as const)(
        'resolves a compound only when the two roles are directly adjacent: $name',
        ({ name, role, evidence }) => {
            expect(getCanonicalTrackRole(input(name))).toEqual({ role, source: 'name-tags', evidence });
        }
    );
    it.each([
        'Kick Drum & Vox',
        'Bass Drum / Vocal',
        'Synth Pad + Vocals',
        'Vocals and Kick Drum',
        'Kick Drum/Vocal',
        'Vox, Bass Drum',
        'Synth Pad & Vocal',
        'Vocal + Pad Synth',
        'Synth Lead Vocal + Vox',
    ])('keeps independent bare vocal labels as conflicting name evidence: %s', (name) => {
        expect(getCanonicalTrackRole(input(name))).toEqual({
            role: 'unknown',
            source: 'name-tags',
            evidence: 'conflicting-name-tags',
        });
    });
    it.each([
        { name: 'Synth Lead Vocal', role: 'lead vocal' },
        { name: 'Backing Vocals Synth', role: 'backing vocal' },
    ] as const)('preserves qualified vocal synth compounds: $name', ({ name, role }) => {
        expect(getCanonicalTrackRole(input(name))).toEqual({
            role,
            source: 'name-tags',
            evidence: 'resolved-name-tags',
        });
    });
    it.each([
        { name: 'Vocal Vocal', role: 'lead vocal', evidence: 'resolved-name-tags' },
        { name: 'Vocals + Vox', role: 'lead vocal', evidence: 'resolved-name-tags' },
        { name: 'Lead Vocal Vox', role: 'lead vocal', evidence: 'name-tokens' },
        { name: 'Lead Vox Vocal', role: 'lead vocal', evidence: 'resolved-name-tags' },
        { name: 'Backing Vocal Vox', role: 'backing vocal', evidence: 'name-tokens' },
        { name: 'Background Vox Vocal', role: 'backing vocal', evidence: 'resolved-name-tags' },
    ] as const)(
        'does not treat repeated or consistently qualified vocal labels as conflicts: $name',
        ({ name, role, evidence }) => {
            expect(getCanonicalTrackRole(input(name))).toEqual({
                role,
                source: 'name-tags',
                evidence,
            });
        }
    );
    it.each(['Bassoon', 'Kickstarter', 'Track 1', 'MIDI Audio Instrument'])(
        'does not invent timbre from %s',
        (name) => {
            expect(getCanonicalTrackRole(input(name)).role).toBe('unknown');
        }
    );
    it.each([
        { name: 'OH', role: 'overhead', evidence: 'name-tokens' },
        { name: 'OH L', role: 'overhead', evidence: 'name-tokens' },
        { name: 'Overheads', role: 'overhead', evidence: 'name-tokens' },
        { name: 'Drum Overheads', role: 'overhead', evidence: 'resolved-name-tags' },
        { name: 'Overhead Drums', role: 'overhead', evidence: 'resolved-name-tags' },
        { name: 'BD', role: 'kick', evidence: 'name-tokens' },
        { name: 'BD In', role: 'kick', evidence: 'name-tokens' },
        { name: 'Bass Drum', role: 'kick', evidence: 'resolved-name-tags' },
        { name: 'Kick Out', role: 'kick', evidence: 'name-tokens' },
        { name: 'SD', role: 'snare', evidence: 'name-tokens' },
        { name: 'SD Top', role: 'snare', evidence: 'name-tokens' },
        { name: 'Hat', role: 'hi-hat', evidence: 'name-tokens' },
        { name: 'Hats', role: 'hi-hat', evidence: 'name-tokens' },
        { name: 'Hat 2', role: 'hi-hat', evidence: 'name-tokens' },
        { name: 'Hats Open', role: 'hi-hat', evidence: 'name-tokens' },
        { name: 'Hi Hats', role: 'hi-hat', evidence: 'name-tokens' },
        { name: 'HiHat', role: 'hi-hat', evidence: 'name-tokens' },
        { name: 'HH Open', role: 'hi-hat', evidence: 'name-tokens' },
        { name: 'Hi-Hat', role: 'hi-hat', evidence: 'name-tokens' },
        { name: 'Drum Room', role: 'room', evidence: 'resolved-name-tags' },
        { name: 'Drums Room', role: 'room', evidence: 'resolved-name-tags' },
        { name: 'Room Drums', role: 'room', evidence: 'resolved-name-tags' },
        { name: 'Drum Rooms', role: 'room', evidence: 'resolved-name-tags' },
        { name: 'China', role: 'cymbal', evidence: 'name-tokens' },
        { name: 'Splash 2', role: 'cymbal', evidence: 'name-tokens' },
    ] as const)('names a kit track by its drum abbreviation or kit-mic word: $name', ({ name, role, evidence }) => {
        expect(getCanonicalTrackRole(input(name))).toEqual({ role, source: 'name-tags', evidence });
    });
    it.each([
        // A bare "hat" is a hi-hat only as the whole name; "Hat Tricks" matches neither it nor "hat trick".
        { name: 'Black Hat Synth', role: 'synth' },
        { name: 'Hat Tricks', role: 'unknown' },
    ] as const)('does not read a hat inside a longer name as a hi-hat: $name is $role', ({ name, role }) => {
        expect(getCanonicalTrackRole(input(name)).role).toBe(role);
    });
    it.each(['Room', 'Rooms', 'Amb', 'Ambience', 'Oh Yeah', 'China Girl'])(
        'keeps a drum-sounding word that is not a kit track unknown: %s',
        (name) => {
            expect(getCanonicalTrackRole(input(name)).role).toBe('unknown');
        }
    );
    it.each([
        { name: 'Click', role: 'utility' },
        { name: 'Metronome', role: 'utility' },
        { name: 'Reference', role: 'utility' },
        { name: 'Ref Mix', role: 'utility' },
        { name: 'Guide', role: 'utility' },
        { name: 'Cue 2', role: 'utility' },
        // A football term, not a hi-hat: it is session furniture rather than a drum.
        { name: 'Hat Trick', role: 'utility' },
        { name: 'Hat trick 2', role: 'utility' },
        { name: 'Strings', role: 'strings' },
        { name: 'String 2', role: 'strings' },
        { name: 'Low Strings', role: 'strings' },
        { name: 'Brass', role: 'brass' },
    ] as const)('names session furniture and orchestral parts: $name is $role', ({ name, role }) => {
        expect(getCanonicalTrackRole(input(name))).toMatchObject({ role, source: 'name-tags' });
    });
    // These words describe a track; they claim a name only when no other role does, so they never
    // turn a name another role already names into a conflict.
    it.each([
        { name: 'Rim Click', role: 'percussion' },
        { name: 'Brass Snare', role: 'snare' },
        { name: 'Kick Click', role: 'kick' },
        { name: 'Kick Ref', role: 'kick' },
        { name: 'String Bass', role: 'bass' },
        { name: 'String Pad', role: 'pad' },
        { name: 'Guide Vocal', role: 'lead vocal' },
        // The bare vocal word names the part, so the guide word yields to it.
        { name: 'Guide Vox', role: 'lead vocal' },
        { name: 'Guide Guitar', role: 'guitar' },
        { name: 'Bass Guide', role: 'bass' },
        { name: 'Bass Ref', role: 'bass' },
    ] as const)('lets a modifier word yield to the role the name already names: $name is $role', ({ name, role }) => {
        expect(getCanonicalTrackRole(input(name))).toMatchObject({ role, source: 'name-tags' });
    });
    // By convention a string count or material with "string" names a guitar ("12 String", "Nylon
    // String"), and "gtr" abbreviates guitar. Neither is an orchestral strings section.
    it.each([
        { name: 'Gtr', role: 'guitar' },
        { name: 'Lead Gtr', role: 'guitar' },
        // The abbreviation alone names the guitar here: 5 is not a guitar string count.
        { name: '5 String Gtr', role: 'guitar' },
        { name: 'Bass Gtr', role: 'bass' },
        { name: '12 String', role: 'guitar' },
        { name: '12-String', role: 'guitar' },
        { name: '12 String Gtr', role: 'guitar' },
        { name: 'Nylon String', role: 'guitar' },
        { name: 'Nylon Strings', role: 'guitar' },
        // A count names a guitar only before the singular; "12 Strings" is an orchestral section.
        { name: '8 Strings', role: 'strings' },
        { name: '12 Strings', role: 'strings' },
        { name: 'Gtrs', role: 'guitar' },
        { name: 'Acoustic Gtrs', role: 'guitar' },
        { name: 'Nylon String Gtr', role: 'guitar' },
        { name: 'Steel String Gtr', role: 'guitar' },
        { name: 'Acoustic 12 String', role: 'guitar' },
        // Each count and material alternative alone, with no other guitar evidence in the name.
        { name: 'Steel String', role: 'guitar' },
        { name: '6 String', role: 'guitar' },
        { name: '7 String', role: 'guitar' },
        { name: '8 String', role: 'guitar' },
        // A 5 string count names a banjo, not a guitar and not a section: no role claims it.
        { name: 'Banjo 5 String', role: 'unknown' },
        // Another instrument's string count or material is not a guitar and not a section either.
        { name: '6 String Violin', role: 'unknown' },
        { name: '8 String Ukulele', role: 'unknown' },
        { name: 'Mandolin 8 String', role: 'unknown' },
        { name: '12 String Bouzouki', role: 'unknown' },
        { name: 'Nylon String Ukulele', role: 'unknown' },
        { name: 'Steel String Mandolin', role: 'unknown' },
    ] as const)('names a guitar by string count, material or abbreviation: $name is $role', ({ name, role }) => {
        expect(getCanonicalTrackRole(input(name)).role).toBe(role);
    });
    // An extended-range bass is a bass: the string count belongs to the bass, not to a guitar.
    it.each([
        '5 String Bass',
        '6 String Bass',
        '6-String Bass',
        '7 String Bass',
        '8 String Bass',
        '12 String Bass',
        'Fretless 6 String Bass',
        '6 String Bass Guitar',
        'Bass 6 String',
    ])('keeps an extended-range bass a bass: %s', (name) => {
        expect(getCanonicalTrackRole(input(name)).role).toBe('bass');
    });
    // A bass voicing of a keys-family part is that part ("Bass Keys"); "Bass Synth" stays a bass
    // as before, and a connector keeps the conflict.
    it.each([
        { name: 'Bass Keys', role: 'keys' },
        { name: 'Bass Piano', role: 'keys' },
        { name: 'Bass Organ', role: 'keys' },
        { name: 'Bass Pad', role: 'pad' },
        { name: 'Bass Synth', role: 'bass' },
        { name: 'Bass & Keys', role: 'unknown' },
        { name: 'Bass and Pad', role: 'unknown' },
    ] as const)('reads bass before a keys-family word: $name is $role', ({ name, role }) => {
        expect(getCanonicalTrackRole(input(name)).role).toBe(role);
    });
    // Evidence from the drums family alone still names drums when no adjacency rule picks one role;
    // a conflict that crosses families stays unknown.
    it.each([
        // A generic drums word with exactly one specific piece names that piece when the two are
        // adjacent or joined by a labelling separator (brackets, colon, dot, slash, dash, underscore).
        { name: 'Drums (Room)', role: 'room' },
        { name: 'Room (Drums)', role: 'room' },
        { name: 'Drums/Room', role: 'room' },
        { name: 'Drums: Room', role: 'room' },
        { name: 'Drums (Overheads)', role: 'overhead' },
        { name: 'Drums.Overheads', role: 'overhead' },
        { name: 'Drums - Overheads', role: 'overhead' },
        { name: 'Drums - Kick In', role: 'kick' },
        { name: 'Drums_Kick', role: 'kick' },
        { name: 'DRUMS_KICK', role: 'kick' },
        { name: 'Drums: Kick', role: 'kick' },
        { name: 'Kick (Drums)', role: 'kick' },
        { name: 'Drums - Snare Top', role: 'snare' },
        { name: 'Drums_Snare', role: 'snare' },
        { name: 'Drums - Hi-Hat', role: 'hi-hat' },
        { name: 'Drums_HiHat', role: 'hi-hat' },
        { name: 'Drums - Tom 1', role: 'tom' },
        { name: 'Drums - Ride', role: 'cymbal' },
        // A conjunction or negation between them or before the piece keeps the generic role, and so
        // do two specific pieces.
        { name: 'Drums & Room', role: 'drums' },
        { name: 'Drums + Overheads', role: 'drums' },
        { name: 'Drums and Overheads', role: 'drums' },
        { name: 'Drums (No Overheads)', role: 'drums' },
        { name: 'Drums No Overheads', role: 'drums' },
        { name: 'Drums Without Overheads', role: 'drums' },
        { name: 'Drums w/o Overheads', role: 'drums' },
        { name: 'Drums w/ Overheads', role: 'drums' },
        { name: 'No Overheads (Drums)', role: 'drums' },
        { name: 'Drums & Rooms', role: 'drums' },
        { name: 'Rooms (Drums)', role: 'drums' },
        { name: 'Drum Room Overheads', role: 'drums' },
        // Two specific pieces beside one drums word stay drums, even when one piece sits next to it.
        { name: 'Overheads Drum Room', role: 'drums' },
        { name: 'Drums Room + Overheads', role: 'drums' },
        { name: 'Snare Overhead', role: 'drums' },
        { name: 'Kick & Snare', role: 'drums' },
        { name: 'Drums & Perc', role: 'drums' },
        { name: 'Kick Drum', role: 'kick' },
        { name: 'Drum Room', role: 'room' },
        { name: 'Overhead Drums', role: 'overhead' },
        { name: 'Kick Vocal', role: 'unknown' },
        { name: 'Bass and Guitar', role: 'unknown' },
    ] as const)('keeps a drums-family name in its family: $name is $role', ({ name, role }) => {
        expect(getCanonicalTrackRole(input(name)).role).toBe(role);
    });
    it('keeps two modifier words on one name a conflict', () => {
        expect(getCanonicalTrackRole(input('Strings Click'))).toEqual({
            role: 'unknown',
            source: 'name-tags',
            evidence: 'conflicting-name-tags',
        });
    });
    it.each([
        { name: 'Oh Yeah Vox', role: 'lead vocal' },
        { name: 'BD Synth Lead', role: 'synth' },
        { name: 'SD Card Pad', role: 'pad' },
        { name: 'Ohm Bass Synth', role: 'bass' },
        { name: 'OH Drums', role: 'drums' },
    ] as const)('matches an abbreviation only when it is the whole name, so $name stays $role', ({ name, role }) => {
        expect(getCanonicalTrackRole(input(name)).role).toBe(role);
    });
    it.each(['bus', 'master'] as const)('recognizes structural %s before content', (kind) => {
        const source = content([36]);
        source.track = { ...source.track, kind, name: 'Kick Snare' };
        expect(getCanonicalTrackRole(source)).toEqual({ role: kind, source: 'name-tags', evidence: 'structural-kind' });
    });
    it.each([
        { pitches: [36], role: 'kick' },
        { pitches: [38], role: 'snare' },
        { pitches: [42, 46], role: 'hi-hat' },
        { pitches: [45, 47], role: 'tom' },
        { pitches: [40], role: 'percussion' },
        { pitches: [36, 38], role: 'drums' },
    ])('derives fully mapped factory voices $pitches as $role', ({ pitches, role }) => {
        expect(getCanonicalTrackRole(content(pitches))).toMatchObject({
            role,
            source: 'clip-content',
            evidence: 'stored-drum-voices',
        });
    });
    it('derives a mapped voice from a hydrated legacy drum-kit', () => {
        expect(getCanonicalTrackRole(hydratedLegacyDrumInput(36))).toMatchObject({
            role: 'kick',
            source: 'clip-content',
            evidence: 'stored-drum-voices',
        });
    });
    it.each([99, -1, 128, 40.5])('keeps hydrated legacy drum-kit pitch %s unmapped and bounded', (pitch) => {
        expect(getCanonicalTrackRole(hydratedLegacyDrumInput(pitch))).toMatchObject({
            role: 'unknown',
            source: 'clip-content',
            evidence: 'unmapped-drum-voice',
        });
    });
    const invalidKitParameters: Array<Record<string, number>> = [
        {},
        { kit: -1 },
        { kit: 0.5 },
        { kit: 100 },
        { kit: 0, kitId: 1 },
    ];
    it.each(invalidKitParameters)('refuses missing or invalid kit metadata %s', (parameters) => {
        expect(getCanonicalTrackRole(content([36], parameters)).role).toBe('unknown');
    });
    it.each([[36, 99], [36, -1], [36, 40.5], []].map((pitches) => ({ pitches })))(
        'never discards unknown or invalid pitches $pitches',
        ({ pitches }) => {
            expect(getCanonicalTrackRole(content(pitches)).role).toBe('unknown');
        }
    );
    it('keeps content identity separate from audibility and invalidates note-only changes without exposing notes', () => {
        const source = content([36]);
        const inactive = {
            ...source,
            track: {
                ...source.track,
                muted: true,
                frozen: true,
                clips: [
                    {
                        id: 'c',
                        type: 'midi' as const,
                        muted: true,
                        notes: [{ pitch: 36, velocity: 0, probability: 0 }],
                    },
                ],
            },
        };
        const first = getCanonicalTrackRole(inactive);
        expect(first).toMatchObject({ role: 'kick', source: 'clip-content' });
        const changed = getCanonicalTrackRole({
            ...inactive,
            track: {
                ...inactive.track,
                clips: [{ ...inactive.track.clips[0]!, notes: [{ pitch: 38, velocity: 0, probability: 0 }] }],
            },
        });
        expect(changed.role).toBe('snare');
        expect(changed.contentRevision).not.toBe(first.contentRevision);
        expect(JSON.stringify(first)).not.toMatch(/pitch|velocity|notes|media/);
    });
    it('keeps opaque audio and mixed audio plus mapped MIDI unknown', () => {
        const source = content([36]);
        source.track = { ...source.track, clips: [...source.track.clips, { id: 'audio', type: 'audio' }] };
        expect(getCanonicalTrackRole(source)).toMatchObject({ role: 'unknown', evidence: 'opaque-content' });
    });
    it('joins strict supplied Toaster metadata and preserves unknown notes beside known notes', () => {
        const source = content([36]);
        source.track = {
            ...source.track,
            devices: [{ type: 'toaster', parameterValues: {}, deviceState: getToasterPresetDeviceState('init') }],
        };
        expect(getCanonicalTrackRole(source)).toMatchObject({ role: 'kick', source: 'clip-content' });
        source.track = { ...source.track, clips: [{ id: 'c', type: 'midi', notes: [{ pitch: 36 }, { pitch: 99 }] }] };
        expect(getCanonicalTrackRole(source)).toMatchObject({ role: 'unknown', evidence: 'unmapped-drum-voice' });
        source.track = { ...source.track, devices: [{ type: 'toaster', parameterValues: {} }] };
        expect(getCanonicalTrackRole(source)).toMatchObject({
            role: 'unknown',
            evidence: 'missing-instrument-metadata',
        });
    });
    it('keeps sample-only and unrecognized Toaster engines unknown even beside a known voice', () => {
        for (const engineType of ['sample', 'unknown', 'cr78-drum']) {
            const source = content([36, 37]);
            source.track = {
                ...source.track,
                devices: [
                    {
                        type: 'toaster',
                        parameterValues: {},
                        deviceState: {
                            version: 1,
                            data: {
                                kit: {
                                    pads: Array.from({ length: 16 }, (_, index) => ({
                                        midiNote: 36 + index,
                                        engineType: index === 0 ? 'kick-808' : engineType,
                                    })),
                                },
                            },
                        },
                    },
                ],
            };
            expect(getCanonicalTrackRole(source)).toMatchObject({ role: 'unknown', evidence: 'unmapped-drum-voice' });
        }
    });
    it('does not infer content identity from generic instruments or an unknown additional instrument', () => {
        const source = content([36]);
        source.track = {
            ...source.track,
            devices: [...source.track.devices, { type: 'external', parameterValues: {} }],
        };
        expect(getCanonicalTrackRole(source).role).toBe('unknown');
    });
    it('reads supplied MIDI separately and never reads performance patterns as clip evidence', () => {
        const source = content([]);
        source.track = { ...source.track, clips: [{ id: 'c', type: 'midi' }] };
        source.notesByClipId = { c: [{ pitch: 38 }] };
        expect(getCanonicalTrackRole(source).role).toBe('snare');
        source.notesByClipId = {};
        expect(getCanonicalTrackRole(source).role).toBe('unknown');
    });
    it.each([
        { hydrated: [38], role: 'snare', evidence: 'stored-drum-voices' },
        { hydrated: [99], role: 'unknown', evidence: 'unmapped-drum-voice' },
        { hydrated: [], role: 'unknown', evidence: 'empty-content' },
    ])(
        'uses an authoritative hydrated note entry $hydrated before conflicting inline notes',
        ({ hydrated, role, evidence }) => {
            const source = content([36]);
            source.notesByClipId = { c: hydrated.map((pitch) => ({ pitch })) };

            expect(getCanonicalTrackRole(source)).toMatchObject({ role, evidence });
        }
    );
});
