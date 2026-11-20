import { describe, expect, it } from 'vitest';

import { type TakeLaneStoreState } from '#/modules/Arrangement/stores';

import { clearPianoRollSelection } from '../clearPianoRollSelection';
import { projectPianoRollTakeNotes } from '../midiClipData/projectPianoRollTakeNotes';
import { readPianoRollSelection } from '../readPianoRollSelection';
import { setPianoRollSelection } from '../setPianoRollSelection';

describe('piano roll selection lifecycle', () => {
    it('changes its token across selection and clip changes, even after returning to the same selection', () => {
        clearPianoRollSelection();
        setPianoRollSelection('clip-a', ['view-a']);
        const first = readPianoRollSelection();
        setPianoRollSelection('clip-a', ['view-b']);
        const second = readPianoRollSelection();
        setPianoRollSelection('clip-a', ['view-a']);
        const returned = readPianoRollSelection();
        setPianoRollSelection('clip-b', ['view-a']);
        const otherClip = readPianoRollSelection();

        expect(first).toMatchObject({ clipId: 'clip-a', viewIds: ['view-a'] });
        expect(new Set([first.token, second.token, returned.token, otherClip.token]).size).toBe(4);
        expect(otherClip).toMatchObject({ clipId: 'clip-b', viewIds: ['view-a'] });
    });

    it('does not retain mutable caller arrays and retires the selection on close', () => {
        const ids = ['view-a'];
        setPianoRollSelection('clip-a', ids);
        const opened = readPianoRollSelection();
        ids.push('view-b');
        opened.viewIds.push('view-c');
        expect(readPianoRollSelection().viewIds).toEqual(['view-a']);
        clearPianoRollSelection();
        expect(readPianoRollSelection()).toMatchObject({ clipId: null, viewIds: [] });
        expect(readPianoRollSelection().token).not.toBe(opened.token);
    });

    it('retains the primary and concurrently open clip identities', () => {
        setPianoRollSelection('clip-a', ['note-b'], ['clip-a', 'clip-b']);
        const result = readPianoRollSelection();
        expect(result.clipIds).toEqual(['clip-a', 'clip-b']);
        result.clipIds.pop();
        expect(readPianoRollSelection().clipIds).toEqual(['clip-a', 'clip-b']);
    });

    it('resolves selected view IDs to the owning open clip and refuses actual duplicate IDs', () => {
        const note = (id: string) => ({ id, pitch: 67, startBeat: 0, duration: 1, velocity: 80 });
        const project = (clipId: string, id: string) => ({
            clipId,
            projection: projectPianoRollTakeNotes({ id: clipId, startBeat: 0, endBeat: 4 }, 'track', null, [note(id)]),
        });
        setPianoRollSelection('a', ['second'], ['a', 'b'], [project('a', 'first'), project('b', 'second')]);
        expect(readPianoRollSelection()).toMatchObject({
            status: 'resolved',
            owners: [{ clipId: 'b', viewId: 'second', ownerClipId: 'b', storedNoteId: 'second' }],
        });
        setPianoRollSelection('a', ['shared'], ['a', 'b'], [project('a', 'shared'), project('b', 'shared')]);
        expect(readPianoRollSelection()).toMatchObject({ status: 'ambiguous', owners: [] });
    });

    it('retains frozen note owner and repeat occurrence from the existing projection', () => {
        const laneState: TakeLaneStoreState = {
            lanes: [
                {
                    id: 'lane',
                    trackId: 'track',
                    takes: [
                        {
                            id: 'take',
                            clipId: 'clip',
                            name: 'Take',
                            startBeat: 0,
                            endBeat: 8,
                            selected: true,
                            midiSource: {
                                sourceClipId: 'source',
                                sourceEntryBeat: 0,
                                sourceEndBeat: 4,
                                phaseHeadBeat: 0,
                                passLengthBeats: 4,
                                rows: {
                                    notes: {
                                        present: true,
                                        value: [{ id: 'n', pitch: 67, startBeat: 0.5, duration: 1, velocity: 80 }],
                                    },
                                    controlChanges: { present: true, value: [] },
                                    pitchBends: { present: true, value: [] },
                                },
                            },
                        },
                    ],
                    activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: 'take' }],
                },
            ],
        };
        const projection = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 4 },
            'track',
            laneState
        );
        const repeat = projection.notes[1];
        expect(repeat).toBeDefined();
        setPianoRollSelection('clip', [repeat!.id], ['clip'], [{ clipId: 'clip', projection }]);
        expect(readPianoRollSelection()).toMatchObject({
            status: 'resolved',
            owners: [
                {
                    clipId: 'clip',
                    viewId: repeat!.id,
                    ownerClipId: 'source',
                    storedNoteId: 'n',
                    takeId: 'take',
                    occurrenceIndex: 1,
                },
            ],
        });
    });
});
