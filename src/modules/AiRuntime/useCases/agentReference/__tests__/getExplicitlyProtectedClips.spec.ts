import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { getExplicitClipProtection } from '../getExplicitlyProtectedClips';
import { resolveAgentReference } from '../resolveAgentReference';

function createTrack(id: string, name: string, clips: ProjectContextTrack['clips']): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        clipCount: clips.length,
        deviceCount: 0,
        clips,
        devices: [],
    };
}

function createClip(id: string, name: string, locked = false) {
    return {
        id,
        name,
        type: 'audio' as const,
        startBeat: 0,
        endBeat: 8,
        noteCount: 0,
        locked,
    };
}

const bassVerse = createClip('clip-bass-verse', 'Bass Verse', true);
const apostrophe = createClip('clip-drummer-cut', "Drummer's Cut");
const literalSelectedClips = createClip('clip-literal-selected', 'Selected Clips');
const literalSelectedClip = createClip('clip-literal-selected-singular', 'Selected Clip');
const lead = createClip('clip-lead', 'Lead');
const rockAndRoll = createClip('clip-rock-and-roll', 'Rock and Roll');
const literalComma = createClip('clip-literal-comma', 'Verse, Alternate');
const literalMultiline = createClip('clip-literal-multiline', 'Verse,\nAlternate');
const dottedName = createClip('clip-dotted-name', 'Verse.1');
const dottedWordName = createClip('clip-dotted-word-name', 'Verse.alt');
const vocalVerse = createClip('clip-vocal-verse', 'Verse');
const guitarVerse = createClip('clip-guitar-verse', 'Verse');
const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [
        createTrack('track-bass', 'Bass', [
            bassVerse,
            apostrophe,
            literalSelectedClips,
            literalSelectedClip,
            lead,
            rockAndRoll,
            literalComma,
            literalMultiline,
            dottedName,
            dottedWordName,
        ]),
        createTrack('track-vocals', 'Vocals', [vocalVerse]),
        createTrack('track-guitar', 'Guitar', [guitarVerse]),
    ],
    selectedTrackId: 'track-bass',
    selectedClipId: bassVerse.id,
    selectedClipIds: [bassVerse.id],
    activeView: 'arrange',
    playheadPosition: 0,
};

function getProtectedClips(prompt: string, projectContext = context) {
    return getExplicitClipProtection(prompt, projectContext).clips;
}

describe('getExplicitlyProtectedClips', () => {
    it.each([
        "Don't touch Lead, but rename Verse to Chorus",
        'without touching Lead, but set note velocities in Verse to 96',
    ])('protects the clip a prohibition names and reads the request complete: %s', (prompt) => {
        expect(getExplicitClipProtection(prompt, context)).toEqual({
            clips: [{ id: lead.id, name: lead.name }],
            complete: true,
        });
    });

    describe('a protection joined to the next instruction by a bare and', () => {
        const alpha = createClip('clip-alpha', 'Alpha');
        const beta = createClip('clip-beta', 'Beta');
        const copyBeta = createClip('clip-copy-beta', 'Copy Beta');
        const alphaBeta = { ...context, tracks: [createTrack('track-pair', 'Pair', [alpha, beta])] };
        const alphaCopyBeta = { ...context, tracks: [createTrack('track-copy', 'Pair', [alpha, copyBeta])] };
        const alphaOnly = [{ id: alpha.id, name: alpha.name }];

        it.each([
            'leave Alpha alone and rename Beta',
            'leave Alpha alone, and rename Beta',
            'leave Alpha alone and then rename Beta',
            'leave Alpha alone then rename Beta',
            'without touching Alpha and rename Beta to Gamma',
            'without touching Alpha and then rename Beta',
            'without touching Alpha then rename Beta',
            "Don't touch Alpha and rename Beta to Gamma",
            'leave Alpha alone, but rename Beta to Gamma',
            "Don't touch Alpha, but rename Beta to Gamma",
        ])('ends the protection before the next instruction and reads it complete: %s', (prompt) => {
            expect(getExplicitClipProtection(prompt, alphaBeta)).toEqual({ clips: alphaOnly, complete: true });
        });

        it.each([
            'leave Alpha and Beta alone',
            'leave Alpha and Beta alone and rename Gamma',
            'without touching Alpha and Beta',
            'without touching Alpha and Beta and rename Gamma',
        ])('still protects every member of a list: %s', (prompt) => {
            expect(getExplicitClipProtection(prompt, alphaBeta)).toEqual({
                clips: [alpha, beta].map(({ id, name }) => ({ id, name })),
                complete: true,
            });
        });

        it.each(['leave Alpha alone and', 'without touching Alpha and', 'without touching Alpha and then'])(
            'keeps a dangling and incomplete: %s',
            (prompt) => {
                expect(getExplicitClipProtection(prompt, alphaBeta).complete).toBe(false);
            }
        );

        it('does not cut a clip name that starts with an instruction verb', () => {
            expect(getExplicitClipProtection('leave Alpha and Copy Beta alone', alphaCopyBeta)).toEqual({
                clips: [alpha, copyBeta].map(({ id, name }) => ({ id, name })),
                complete: true,
            });
        });

        it.each([
            "Don't touch Alpha and Copy Beta",
            'without touching Alpha and Copy Beta',
            "Don't touch Alpha, Copy Beta",
        ])('keeps a verb-named clip inside a prohibition list: %s', (prompt) => {
            expect(getExplicitClipProtection(prompt, alphaCopyBeta)).toEqual({
                clips: [alpha, copyBeta].map(({ id, name }) => ({ id, name })),
                complete: true,
            });
        });

        it('keeps a word outside the instruction verbs after and as incomplete', () => {
            expect(getExplicitClipProtection('leave Alpha alone and Beta', alphaBeta).complete).toBe(false);
        });
    });

    describe('a clip named like the words that open a protection', () => {
        const alpha = createClip('clip-alpha', 'Alpha');

        it.each([
            ["Don't touch Alpha and rename Alpha to Gamma", 'Touch'],
            ['without touching Alpha and rename Alpha to Gamma', 'Touching'],
            ['no changes to Alpha and rename Alpha to Gamma', 'Changes'],
        ])('still reads the protection of %s beside a clip named %s', (prompt, name) => {
            const sameNamed = createClip('clip-same-named', name);
            const track = createTrack('track-same-named', 'Pair', [alpha, sameNamed]);

            expect(getExplicitClipProtection(prompt, { ...context, tracks: [track] })).toEqual({
                clips: [{ id: alpha.id, name: alpha.name }],
                complete: true,
            });
        });

        it.each([
            ["Don't touch keep me and rename Beta to Gamma", 'keep me', 'Beta'],
            ['leave Alpha alone and rename Alpha to Gamma', 'Leave', 'Alpha'],
        ])('blanks a start inside a clip name: %s', (prompt, name, other) => {
            const named = createClip('clip-named', name);
            const rest = createClip('clip-rest', other);
            const track = createTrack('track-named', 'Pair', [named, rest]);
            const result = getExplicitClipProtection(prompt, { ...context, tracks: [track] });

            expect(result.complete).toBe(true);
            expect(result.clips.map(({ name: protectedName }) => protectedName)).toEqual(
                prompt.startsWith('leave') ? [other] : [name]
            );
        });
    });

    it('reads a carve-out word inside a clip name as incomplete, never as a protected clip', () => {
        const named = createClip('clip-named', 'except me');
        const track = createTrack('track-named', 'Pair', [named, createClip('clip-beta', 'Beta')]);

        expect(
            getExplicitClipProtection("Don't touch except me and rename Beta to Gamma", { ...context, tracks: [track] })
                .complete
        ).toBe(false);
    });

    it('reads a prohibition list ending in a dangling and as incomplete', () => {
        expect(getExplicitClipProtection('without touching Lead and', context).complete).toBe(false);
    });

    it('retains the exact clip candidate beside a same-name track in an aggregate protection', () => {
        const clip = createClip('clip-overall-level', 'Overall Level');
        const project = {
            ...context,
            tracks: [
                createTrack('track-drums', 'Drums', [clip]),
                createTrack('track-overall-level', 'Overall Level', []),
            ],
        };
        expect(
            resolveAgentReference({
                prompt: 'the Overall Level',
                assertedId: clip.id,
                capability: 'clip',
                context: project,
            })
        ).toMatchObject({
            status: 'rejected',
            reason: 'ungrounded-target',
            candidates: [{ id: clip.id, name: clip.name, evidence: ['exact-name'] }],
        });
        expect(getExplicitClipProtection('keep the Overall Level the same', project)).toEqual({
            clips: [{ id: clip.id, name: clip.name }],
            complete: true,
        });
    });

    it('does not borrow the same-name clip for an explicitly track-only fader protection', () => {
        const clip = createClip('clip-overall-level', 'Overall Level');
        const project = {
            ...context,
            tracks: [
                createTrack('track-drums', 'Drums', [clip]),
                createTrack('track-overall-level', 'Overall Level', []),
            ],
        };
        expect(getExplicitClipProtection('keep the fader of "Overall Level" the same', project).clips).toEqual([]);
    });

    it.each([
        'add an EQ to every audio track but leave the vocal alone',
        'turn down the drums by 3 dB but leave Bass Verse alone',
    ])('leaves an ordinary restriction to target authority when it names no clip in %s', (prompt) => {
        const project = { ...context, tracks: [createTrack('track-drums', 'Drums', [])] };
        expect(getExplicitClipProtection(prompt, project)).toEqual({ clips: [], complete: true });
    });

    it.each(['Overall Level', 'Overall level'])(
        'fully reads a closed unbound aggregate control %s without inventing a clip',
        (quality) => {
            expect(getExplicitClipProtection(`keep the ${quality} the same`, context)).toEqual({
                clips: [],
                complete: true,
            });
        }
    );

    it.each(['Overall', 'Overall Level'])(
        'keeps the actual clip %s protected before interpreting aggregate control wording',
        (name) => {
            const clip = createClip('clip-overall', name);
            const project = { ...context, tracks: [createTrack('track-drums', 'Drums', [clip])] };
            expect(getExplicitClipProtection('keep the Overall Level the same', project)).toEqual({
                clips: [{ id: clip.id, name }],
                complete: true,
            });
        }
    );

    it.each([
        'keep the "Overall Level" the same',
        'keep "the" Overall Level the same',
        'keep the Overall clip the same',
        'keep the Overall Level and Missing clip the same',
        'keep the Overall Level the same; keep the Missing clip unchanged',
        'keep the Overall Level the same with the Missing clip',
        'keep the Overall Level the same; keep the fader of "Ghost" the same',
        'keep the Overall Level the same; keep unchanged',
    ])('retains an incomplete protection beside aggregate wording in %s', (prompt) => {
        expect(getExplicitClipProtection(prompt, context).complete).toBe(false);
    });

    it.each(['keep “Bass Verse” the same', 'keep Bass Verse as is', "leave Drummer's Cut alone"])(
        'uses the shared closed grammar without losing a clip name in %s',
        (prompt) => {
            expect(getExplicitClipProtection(prompt, context)).toEqual({
                clips: [
                    {
                        id: prompt.includes('Drummer') ? apostrophe.id : bassVerse.id,
                        name: prompt.includes('Drummer') ? apostrophe.name : bassVerse.name,
                    },
                ],
                complete: true,
            });
        }
    );

    it.each([
        ['leave Bass Verse unchanged', bassVerse],
        ['leaving "Bass Verse" unchanged', bassVerse],
        ["keep 'Bass Verse' unchanged", bassVerse],
        ['keeping “Bass Verse” unchanged', bassVerse],
        ['preserve ‘Bass Verse’ unchanged', bassVerse],
        ['preserving clip-bass-verse unchanged', bassVerse],
        ["keep Drummer's Cut unchanged", apostrophe],
    ])('resolves an exact protected clip from %s', (prompt, clip) => {
        expect(getProtectedClips(prompt, context)).toContainEqual({
            id: clip.id,
            name: clip.name,
        });
    });

    it('keeps every ambiguous duplicate-name candidate protected', () => {
        expect(getProtectedClips('leave Verse unchanged', context)).toEqual([
            { id: vocalVerse.id, name: vocalVerse.name },
            { id: guitarVerse.id, name: guitarVerse.name },
        ]);
    });

    it('honors an owner qualification for duplicate clip names', () => {
        expect(getProtectedClips('keep Verse on Vocals unchanged', context)).toEqual([
            { id: vocalVerse.id, name: vocalVerse.name },
        ]);
    });

    it('ignores preservation words inside a quoted rename value', () => {
        expect(getProtectedClips('rename clip to "leave Bass Verse unchanged"', context)).toEqual([]);
    });

    it('protects every selected clip named by an unquoted plural selection reference', () => {
        const multiSelectionContext = {
            ...context,
            selectedClipIds: [bassVerse.id, apostrophe.id],
        };

        expect(getProtectedClips('leave selected clips unchanged', multiSelectionContext)).toEqual([
            { id: bassVerse.id, name: bassVerse.name },
            { id: apostrophe.id, name: apostrophe.name },
        ]);
        expect(getProtectedClips('leave "selected clips" unchanged', multiSelectionContext)).toEqual([
            { id: literalSelectedClips.id, name: literalSelectedClips.name },
        ]);
    });

    it('distinguishes an unquoted selected clip from a quoted literal name', () => {
        expect(getProtectedClips('leave selected clip unchanged', context)).toEqual([
            { id: bassVerse.id, name: bassVerse.name },
        ]);
        expect(getProtectedClips('leave "Selected Clip" unchanged', context)).toEqual([
            { id: literalSelectedClip.id, name: literalSelectedClip.name },
        ]);
    });

    it.each([
        'leave selected clips and Lead unchanged',
        'leave Lead and selected clips unchanged',
        'leave selected clips, and Lead unchanged',
    ])('unions selected and named protected references for %s', (prompt) => {
        const multiSelectionContext = {
            ...context,
            selectedClipIds: [bassVerse.id, apostrophe.id],
        };

        expect(getProtectedClips(prompt, multiSelectionContext)).toEqual(
            expect.arrayContaining([
                { id: bassVerse.id, name: bassVerse.name },
                { id: apostrophe.id, name: apostrophe.name },
                { id: lead.id, name: lead.name },
            ])
        );
    });

    it('resolves each qualified protected reference without sharing owner qualifiers', () => {
        expect(getProtectedClips('leave Verse on Vocals and Verse on Guitar unchanged', context)).toEqual([
            { id: vocalVerse.id, name: vocalVerse.name },
            { id: guitarVerse.id, name: guitarVerse.name },
        ]);
    });

    it('keeps full literal names and quoted delimiters protected', () => {
        expect(getProtectedClips('leave Rock and Roll unchanged', context)).toContainEqual({
            id: rockAndRoll.id,
            name: rockAndRoll.name,
        });
        expect(getProtectedClips('leave "Verse, Alternate" and "Rock and Roll" unchanged', context)).toEqual(
            expect.arrayContaining([
                { id: rockAndRoll.id, name: rockAndRoll.name },
                { id: literalComma.id, name: literalComma.name },
            ])
        );
    });

    it.each([
        ['leave selected\nclips unchanged', [bassVerse, apostrophe]],
        ['leave Bass Verse,\nLead unchanged', [bassVerse, lead]],
        ['leave selected\r\nclips unchanged', [bassVerse, apostrophe]],
    ])('extracts a protected list across semantic newlines for %s', (prompt, expectedClips) => {
        const multiSelectionContext = {
            ...context,
            selectedClipIds: [bassVerse.id, apostrophe.id],
        };

        expect(getProtectedClips(prompt, multiSelectionContext)).toEqual(
            expect.arrayContaining(expectedClips.map(({ id, name }) => ({ id, name })))
        );
    });

    it('keeps independent protection clauses and quoted multiline names separate', () => {
        expect(getProtectedClips('leave Bass Verse unchanged; keep Lead unchanged', context)).toEqual(
            expect.arrayContaining([
                { id: bassVerse.id, name: bassVerse.name },
                { id: lead.id, name: lead.name },
            ])
        );
        expect(getProtectedClips('leave "Verse,\nAlternate" unchanged', context)).toContainEqual({
            id: literalMultiline.id,
            name: literalMultiline.name,
        });
    });

    it('carries exclusion clauses across later instructions and resolves each list member', () => {
        const prompt = 'excluding Lead and Bass Verse, set another clip velocity; set Verse to 100';
        expect(getProtectedClips(prompt)).toEqual(
            expect.arrayContaining([
                { id: lead.id, name: lead.name },
                { id: bassVerse.id, name: bassVerse.name },
            ])
        );
        expect(getProtectedClips('set Verse to 90, excluding Lead; set Bass Verse to 100')).toContainEqual({
            id: lead.id,
            name: lead.name,
        });
        expect(getProtectedClips('set Verse to 90 except Lead; set Bass Verse to 100')).toContainEqual({
            id: lead.id,
            name: lead.name,
        });
        expect(
            getExplicitClipProtection('set Verse to 90, excluding Lead and Missing; set Bass Verse to 100', context)
                .complete
        ).toBe(false);
    });

    it.each([
        'set note velocities in Bass Verse to 90, excluding Lead, rename Bass Verse to "set 100"',
        'set note velocities in Bass Verse to 90, excluding Lead and then rename Bass Verse to "set 100"',
        'set note velocities in Bass Verse to 90, excluding Lead; rename Bass Verse to "set 100"',
    ])('ends an exclusion at a following rename instruction for %s', (prompt) => {
        expect(getExplicitClipProtection(prompt, context)).toEqual({
            clips: [{ id: lead.id, name: lead.name }],
            complete: true,
        });
    });

    it('keeps whole-name protection and unresolved list members together', () => {
        const chorus = createClip('clip-chorus', 'Chorus');
        const wholeName = createClip('clip-chorus-and-missing', 'Chorus and Missing');
        const chorusContext = {
            ...context,
            tracks: [createTrack('track-chorus', 'Chorus', [chorus, wholeName])],
        };
        expect(getExplicitClipProtection('set Chorus to 90, excluding Chorus and Missing', chorusContext)).toEqual({
            clips: [
                { id: chorus.id, name: chorus.name },
                { id: wholeName.id, name: wholeName.name },
            ],
            complete: false,
        });
        expect(getExplicitClipProtection('set Chorus to 90, excluding "Chorus and Missing"', chorusContext)).toEqual({
            clips: [{ id: wholeName.id, name: wholeName.name }],
            complete: true,
        });
    });

    it('marks an unquoted whole-name collision incomplete when every list member is unresolved', () => {
        const wholeName = createClip('clip-alpha-and-omega', 'Alpha and Omega');
        const collisionContext = {
            ...context,
            tracks: [createTrack('track-collision', 'Collision', [wholeName])],
        };

        expect(getExplicitClipProtection('set Verse to 90, excluding Alpha and Omega', collisionContext)).toEqual({
            clips: [{ id: wholeName.id, name: wholeName.name }],
            complete: false,
        });
        expect(getExplicitClipProtection('set Verse to 90, excluding "Alpha and Omega"', collisionContext)).toEqual({
            clips: [{ id: wholeName.id, name: wholeName.name }],
            complete: true,
        });
    });

    it('treats quoted exclusion words as names and keeps quoted excluded names literal', () => {
        expect(getProtectedClips('rename Lead to "excluding Bass Verse"')).toEqual([]);
        expect(getProtectedClips('set Verse to 90, excluding "Rock and Roll"')).toContainEqual({
            id: rockAndRoll.id,
            name: rockAndRoll.name,
        });
    });

    it('leaves track-only restrictions to their owning protection scope', () => {
        expect(
            getExplicitClipProtection(
                'insert a compressor on bass tracks, excluding frozen tracks, and keep Guitar unchanged',
                {
                    ...context,
                    tracks: [...context.tracks, createTrack('track-guitar-only', 'Guitar', [])],
                }
            )
        ).toEqual({ clips: [], complete: true });
        expect(getExplicitClipProtection('set Verse to 90, excluding Missing clip', context).complete).toBe(false);
        expect(
            getExplicitClipProtection('set Verse to 90, excluding frozen tracks and Missing clip', context).complete
        ).toBe(false);
        expect(
            getExplicitClipProtection('keep Lead unchanged', {
                ...context,
                tracks: [...context.tracks, createTrack('track-lead', 'Lead', [])],
            }).clips
        ).toContainEqual({ id: lead.id, name: lead.name });
    });

    it.each(['set Verse to 90, excluding', 'set Verse to 90, excluding; set Lead to 100'])(
        'marks an unfinished exclusion incomplete for %s',
        (prompt) => {
            expect(getExplicitClipProtection(prompt, context).complete).toBe(false);
        }
    );

    it.each([
        ['leave Verse.1 unchanged', dottedName],
        ['leave "Verse.1" unchanged', dottedName],
        ['leave Verse.alt unchanged', dottedWordName],
        ['leave "Verse.alt" unchanged', dottedWordName],
    ])('preserves a dotted clip name in %s', (prompt, clip) => {
        expect(getProtectedClips(prompt, context)).toContainEqual({ id: clip.id, name: clip.name });
    });

    it.each([
        'rename Lead to Opening; leave unchanged',
        'rename Lead to Opening; leave Bass Verse and unchanged',
        'rename Lead to Opening; leave and Bass Verse unchanged',
        'rename Lead to Opening; leave Bass Verse, , Lead unchanged',
        'rename Lead to Opening; leave "Bass Verse unchanged',
        'rename Lead to Opening; leave Bass Verse; mute Lead',
    ])('marks malformed protection syntax incomplete for %s', (prompt) => {
        expect(getExplicitClipProtection(prompt, context).complete).toBe(false);
    });
});
