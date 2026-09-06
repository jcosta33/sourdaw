import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { getExplicitClipProtection } from '../getExplicitlyProtectedClips';

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
