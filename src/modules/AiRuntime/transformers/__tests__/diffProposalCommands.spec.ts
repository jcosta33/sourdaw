import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { proposalCommandShape } from '../../useCases/agentReference/proposalCommandShape';
import { diffProposalCommands } from '../diffProposalCommands';

type Proposal = Parameters<typeof diffProposalCommands>[0];

/** The diff as the approval view runs it, with command identity read from the action registry. */
function diff(previous: Proposal, next: Proposal) {
    return diffProposalCommands(previous, next, proposalCommandShape.identityArguments);
}

describe('diffProposalCommands', () => {
    it('retains the actual unchanged occurrence when an earlier clip on the same track is removed', () => {
        const bar1 = { type: 'addClip', payload: { trackId: 'midi-1', startBeat: 0, endBeat: 4 } };
        const bar2 = { type: 'addClip', payload: { trackId: 'midi-1', startBeat: 4, endBeat: 8 } };

        expect(
            diff(
                { actions: [bar1, bar2], actionLabels: ['Bar 1', 'Bar 2'] },
                { actions: [bar2], actionLabels: ['Bar 2'] }
            )
        ).toEqual({
            changes: [{ kind: 'removed', actionType: 'addClip', label: 'Bar 1' }],
            unchangedCount: 1,
        });
    });

    it('pairs repeated reordered commands exactly before reporting changed and added peers', () => {
        const first = { type: 'addClip', payload: { trackId: 'midi-1', startBeat: 0, endBeat: 4 } };
        const second = { type: 'addClip', payload: { trackId: 'midi-1', startBeat: 4, endBeat: 8 } };
        const changed = { type: 'addClip', payload: { trackId: 'midi-1', startBeat: 0, endBeat: 6 } };
        const added = { type: 'addClip', payload: { trackId: 'midi-2', startBeat: 8, endBeat: 12 } };

        expect(
            diff(
                { actions: [first, second], actionLabels: ['Bar 1', 'Bar 2'] },
                { actions: [second, changed, added], actionLabels: ['Bar 2', 'Long bar 1', 'New clip'] }
            )
        ).toEqual({
            changes: [
                {
                    kind: 'changed',
                    actionType: 'addClip',
                    label: 'Long bar 1',
                    fields: [{ field: 'endBeat', previous: '4', next: '6' }],
                },
                { kind: 'added', actionType: 'addClip', label: 'New clip' },
            ],
            unchangedCount: 1,
        });
    });

    it('does not assign a fresh clip to either old clip when both share one target', () => {
        const first = {
            type: 'addClip',
            payload: { trackId: 'midi-1', clipId: 'clip-old-a', name: 'Verse', startBeat: 0, endBeat: 4 },
        };
        const second = {
            type: 'addClip',
            payload: { trackId: 'midi-1', clipId: 'clip-old-b', name: 'Chorus', startBeat: 4, endBeat: 8 },
        };
        const replacement = {
            type: 'addClip',
            payload: { trackId: 'midi-1', clipId: 'clip-fresh', name: 'Bridge', startBeat: 0, endBeat: 8 },
        };

        expect(
            diff(
                { actions: [first, second], actionLabels: ['Verse clip', 'Chorus clip'] },
                { actions: [replacement], actionLabels: ['Bridge clip'] }
            )
        ).toEqual({
            changes: [
                { kind: 'added', actionType: 'addClip', label: 'Bridge clip' },
                { kind: 'removed', actionType: 'addClip', label: 'Verse clip' },
                { kind: 'removed', actionType: 'addClip', label: 'Chorus clip' },
            ],
            unchangedCount: 0,
        });
    });

    it('uses clip identity for moves while keeping a different removal target separate', () => {
        const moveFromTrackA = {
            type: 'moveClip',
            payload: { clipId: 'clip-a', trackId: 'track-a', startBeat: 0 },
        } satisfies AppAction;
        const moveToTrackB = {
            type: 'moveClip',
            payload: { clipId: 'clip-a', trackId: 'track-b', startBeat: 0 },
        } satisfies AppAction;
        const removeClipA = { type: 'removeClip', payload: { clipId: 'clip-a' } } satisfies AppAction;
        const removeClipB = { type: 'removeClip', payload: { clipId: 'clip-b' } } satisfies AppAction;
        const keepRename = { type: 'renameClip', payload: { clipId: 'clip-c', name: 'Intro' } } satisfies AppAction;

        expect(
            diff(
                {
                    actions: [moveFromTrackA, removeClipA, keepRename],
                    actionLabels: ['Move clip', 'Remove clip A', 'Keep clip name'],
                },
                {
                    actions: [moveToTrackB, removeClipB, keepRename],
                    actionLabels: ['Move clip', 'Remove clip B', 'Keep clip name'],
                }
            )
        ).toEqual({
            changes: [
                {
                    kind: 'changed',
                    actionType: 'moveClip',
                    label: 'Move clip',
                    fields: [{ field: 'trackId', previous: 'track-a', next: 'track-b' }],
                },
                { kind: 'added', actionType: 'removeClip', label: 'Remove clip B' },
                { kind: 'removed', actionType: 'removeClip', label: 'Remove clip A' },
            ],
            unchangedCount: 1,
        });
    });

    it('separates a rename of another clip and compares a rename of the same clip', () => {
        const before = { type: 'renameClip', payload: { clipId: 'clip-verse', name: 'Verse' } } satisfies AppAction;
        const otherClip = {
            type: 'renameClip',
            payload: { clipId: 'clip-chorus', name: 'Chorus' },
        } satisfies AppAction;
        const sameClip = { type: 'renameClip', payload: { clipId: 'clip-verse', name: 'Chorus' } } satisfies AppAction;

        expect(
            diff(
                { actions: [before], actionLabels: ['Rename Verse clip'] },
                { actions: [otherClip], actionLabels: ['Rename Chorus clip'] }
            )
        ).toEqual({
            changes: [
                { kind: 'added', actionType: 'renameClip', label: 'Rename Chorus clip' },
                { kind: 'removed', actionType: 'renameClip', label: 'Rename Verse clip' },
            ],
            unchangedCount: 0,
        });
        expect(
            diff(
                { actions: [before], actionLabels: ['Rename Verse clip'] },
                { actions: [sameClip], actionLabels: ['Rename clip to Chorus'] }
            )
        ).toEqual({
            changes: [
                {
                    kind: 'changed',
                    actionType: 'renameClip',
                    label: 'Rename clip to Chorus',
                    fields: [{ field: 'name', previous: 'Verse', next: 'Chorus' }],
                },
            ],
            unchangedCount: 0,
        });
    });

    it('pairs two parameter changes on one device by parameter, not by their order (#4380 row 22)', () => {
        const frequency = (value: number) =>
            ({
                type: 'setDeviceParameter',
                payload: { deviceId: 'device-eq', paramId: 'eq-mid-freq', value },
            }) satisfies AppAction;
        const gain = (value: number) =>
            ({
                type: 'setDeviceParameter',
                payload: { deviceId: 'device-eq', paramId: 'eq-mid-gain', value },
            }) satisfies AppAction;

        expect(
            diff(
                { actions: [frequency(1000), gain(-3)], actionLabels: ['EQ mid frequency', 'EQ mid gain'] },
                { actions: [gain(-6), frequency(2000)], actionLabels: ['EQ mid gain', 'EQ mid frequency'] }
            )
        ).toEqual({
            changes: [
                {
                    kind: 'changed',
                    actionType: 'setDeviceParameter',
                    label: 'EQ mid gain',
                    fields: [{ field: 'value', previous: '-3', next: '-6' }],
                },
                {
                    kind: 'changed',
                    actionType: 'setDeviceParameter',
                    label: 'EQ mid frequency',
                    fields: [{ field: 'value', previous: '1000', next: '2000' }],
                },
            ],
            unchangedCount: 0,
        });
    });
});
