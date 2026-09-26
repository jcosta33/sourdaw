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
    it.each(['Kick Snare', 'Bass Guitar', 'Lead Vocal Backing Vocal'])(
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
        { name: 'Bass Guitar', role: 'unknown', evidence: 'conflicting-name-tags' },
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
        { name: 'Drums & Perc', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Synth & Guitar', role: 'unknown', evidence: 'conflicting-name-tags' },
        { name: 'Drum Bass', role: 'unknown', evidence: 'conflicting-name-tags' },
    ] as const)(
        'resolves a compound only when the two roles are directly adjacent: $name',
        ({ name, role, evidence }) => {
            expect(getCanonicalTrackRole(input(name))).toEqual({ role, source: 'name-tags', evidence });
        }
    );
    it.each(['Bassoon', 'Kickstarter', 'Track 1', 'MIDI Audio Instrument'])(
        'does not invent timbre from %s',
        (name) => {
            expect(getCanonicalTrackRole(input(name)).role).toBe('unknown');
        }
    );
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
