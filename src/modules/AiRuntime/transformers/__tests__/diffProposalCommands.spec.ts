import { describe, expect, it } from 'vitest';

import { canonicalJson } from '#/utils/canonicalDigest';
import { type AppAction } from '#/utils/handlerContract';

import { proposalCommandShape } from '../../useCases/agentReference/proposalCommandShape';
import { diffProposalCommands } from '../diffProposalCommands';

type Proposal = Parameters<typeof diffProposalCommands>[0];

/** The diff as the approval view runs it, with command identity read from the action registry. */
function diff(previous: Proposal, next: Proposal) {
    return diffProposalCommands(previous, next, proposalCommandShape.identity);
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

    it('pairs neither of two changed peers on one object with the one command they could replace', () => {
        const pending = { type: 'setTrackGain', payload: { trackId: 'track-vocals', deltaDb: -3 } };
        const smaller = { type: 'setTrackGain', payload: { trackId: 'track-vocals', deltaDb: -1 } };
        const larger = { type: 'setTrackGain', payload: { trackId: 'track-vocals', deltaDb: -6 } };

        expect(
            diff(
                { actions: [pending], actionLabels: ['Vocals -3 dB'] },
                { actions: [smaller, larger], actionLabels: ['Vocals -1 dB', 'Vocals -6 dB'] }
            )
        ).toEqual({
            changes: [
                { kind: 'added', actionType: 'setTrackGain', label: 'Vocals -1 dB' },
                { kind: 'added', actionType: 'setTrackGain', label: 'Vocals -6 dB' },
                { kind: 'removed', actionType: 'setTrackGain', label: 'Vocals -3 dB' },
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

    it('renders decibel fields at two trimmed decimals, so distinct values look distinct', () => {
        const vocals = (field: 'gainDb' | 'deltaDb', value: number) => ({
            type: 'setTrackGain',
            payload: { trackId: 'track-vocals', [field]: value },
        });
        const rows: Array<['gainDb' | 'deltaDb', number, number, string, string]> = [
            ['gainDb', -1.25, -1.3, '-1.25 dB', '-1.3 dB'],
            ['gainDb', -1.04, -1, '-1.04 dB', '-1 dB'],
            ['deltaDb', -1.25, -1.3, '-1.25 dB', '-1.3 dB'],
            ['deltaDb', -1.04, -1, '-1.04 dB', '-1 dB'],
            ['deltaDb', -6, -1.333, '-6 dB', '-1.33 dB'],
        ];
        for (const [field, before, after, previous, next] of rows) {
            expect(
                diff(
                    { actions: [vocals(field, before)], actionLabels: ['Before'] },
                    { actions: [vocals(field, after)], actionLabels: ['After'] }
                ).changes
            ).toEqual([
                { kind: 'changed', actionType: 'setTrackGain', label: 'After', fields: [{ field, previous, next }] },
            ]);
        }
    });

    describe('pairs a command by the object it acts on, not by every argument the registry calls a target', () => {
        function changedOnly(actionType: string, before: Record<string, unknown>, after: Record<string, unknown>) {
            return diff(
                { actions: [{ type: actionType, payload: before }], actionLabels: ['Before'] },
                { actions: [{ type: actionType, payload: after }], actionLabels: ['After'] }
            );
        }

        it('pairs a placement of the same clip whose start moved', () => {
            const moves = (startBeat: number) => [{ clipId: 'clip-1', trackId: 'track-1', startBeat }];

            expect(changedOnly('moveClips', { moves: moves(4) }, { moves: moves(8) })).toEqual({
                changes: [
                    {
                        kind: 'changed',
                        actionType: 'moveClips',
                        label: 'After',
                        fields: [{ field: 'moves', previous: canonicalJson(moves(4)), next: canonicalJson(moves(8)) }],
                    },
                ],
                unchangedCount: 0,
            });
        });

        it('keeps placements of different clips apart', () => {
            const move = (clipId: string) => ({ moves: [{ clipId, trackId: 'track-1', startBeat: 4 }] });

            expect(changedOnly('moveClips', move('clip-1'), move('clip-2')).changes.map(({ kind }) => kind)).toEqual([
                'added',
                'removed',
            ]);
        });

        it('pairs a VCA group and a gain range whose member set changed, by type', () => {
            expect(
                changedOnly(
                    'createVcaGroup',
                    { name: 'Kit', trackIds: ['track-1', 'track-2'] },
                    { name: 'Kit', trackIds: ['track-1', 'track-2', 'track-3'] }
                )
            ).toEqual({
                changes: [
                    {
                        kind: 'changed',
                        actionType: 'createVcaGroup',
                        label: 'After',
                        fields: [
                            {
                                field: 'trackIds',
                                previous: canonicalJson(['track-1', 'track-2']),
                                next: canonicalJson(['track-1', 'track-2', 'track-3']),
                            },
                        ],
                    },
                ],
                unchangedCount: 0,
            });
            expect(
                changedOnly(
                    'automateTrackGainRange',
                    { trackIds: ['track-1', 'track-2'], deltaDb: 2 },
                    { trackIds: ['track-1'], deltaDb: 2 }
                ).changes
            ).toEqual([
                {
                    kind: 'changed',
                    actionType: 'automateTrackGainRange',
                    label: 'After',
                    fields: [
                        {
                            field: 'trackIds',
                            previous: canonicalJson(['track-1', 'track-2']),
                            next: canonicalJson(['track-1']),
                        },
                    ],
                },
            ]);
        });

        it('pairs a send range whose source set changed, by type and bus', () => {
            const sendRange = (trackIds: string[], busId = 'bus-1') => ({
                trackIds,
                busId,
                sectionName: 'Chorus',
                reductionDb: 3,
            });
            const trackIdsChanged = {
                field: 'trackIds',
                previous: canonicalJson(['track-1', 'track-2']),
                next: canonicalJson(['track-1']),
            };

            expect(
                changedOnly('automateSendRange', sendRange(['track-1', 'track-2']), sendRange(['track-1'])).changes
            ).toEqual([
                { kind: 'changed', actionType: 'automateSendRange', label: 'After', fields: [trackIdsChanged] },
            ]);
            expect(
                changedOnly('automateSendRange', sendRange(['track-1']), sendRange(['track-2'])).changes.map(
                    ({ kind }) => kind
                )
            ).toEqual(['changed']);
            expect(
                changedOnly(
                    'automateSendRanges',
                    {
                        trackIds: ['track-1', 'track-2'],
                        busId: 'bus-1',
                        sectionIds: ['s1'],
                        tailBars: 4,
                        targetLevelDb: -12,
                    },
                    { trackIds: ['track-1'], busId: 'bus-1', sectionIds: ['s1'], tailBars: 4, targetLevelDb: -12 }
                ).changes
            ).toEqual([
                { kind: 'changed', actionType: 'automateSendRanges', label: 'After', fields: [trackIdsChanged] },
            ]);
            expect(
                changedOnly('automateSendRange', sendRange(['track-1']), sendRange(['track-1'], 'bus-2')).changes.map(
                    ({ kind }) => kind
                )
            ).toEqual(['added', 'removed']);
        });

        it('pairs send ranges by shared sources when more than one goes to the same bus', () => {
            const sendRange = (trackIds: string[], reductionDb: number) =>
                ({
                    type: 'automateSendRange',
                    payload: { trackIds, busId: 'bus-1', sectionName: 'Chorus', reductionDb },
                }) satisfies AppAction;

            expect(
                diff(
                    {
                        actions: [sendRange(['track-1', 'track-2'], 3), sendRange(['track-3'], 6)],
                        actionLabels: ['Lead sends', 'Pad send'],
                    },
                    {
                        actions: [sendRange(['track-3', 'track-4'], 6), sendRange(['track-1'], 3)],
                        actionLabels: ['Pad sends', 'Lead send'],
                    }
                ).changes.map(({ kind, label }) => [kind, label])
            ).toEqual([
                ['changed', 'Pad sends'],
                ['changed', 'Lead send'],
            ]);
            expect(
                diff(
                    {
                        actions: [sendRange(['track-1'], 3), sendRange(['track-2'], 3)],
                        actionLabels: ['Lead send', 'Pad send'],
                    },
                    { actions: [sendRange(['track-3'], 3)], actionLabels: ['Keys send'] }
                ).changes.map(({ kind }) => kind)
            ).toEqual(['added', 'removed', 'removed']);
        });

        it('pairs a VCA group whose every member changed, by type, since its members are no identity', () => {
            expect(
                changedOnly(
                    'createVcaGroup',
                    { name: 'Kit', trackIds: ['track-1', 'track-2'] },
                    { name: 'Kit', trackIds: ['track-3', 'track-4'] }
                ).changes
            ).toEqual([
                {
                    kind: 'changed',
                    actionType: 'createVcaGroup',
                    label: 'After',
                    fields: [
                        {
                            field: 'trackIds',
                            previous: canonicalJson(['track-1', 'track-2']),
                            next: canonicalJson(['track-3', 'track-4']),
                        },
                    ],
                },
            ]);
        });

        it('pairs each of two send ranges whose sources only reordered with its own, by its sorted sources', () => {
            const sendRange = (trackIds: string[], reductionDb: number) =>
                ({
                    type: 'automateSendRange',
                    payload: { trackIds, busId: 'bus-1', sectionName: 'Chorus', reductionDb },
                }) satisfies AppAction;

            expect(
                diff(
                    {
                        actions: [sendRange(['track-1', 'track-2'], 3), sendRange(['track-2', 'track-3'], 6)],
                        actionLabels: ['Lead sends', 'Pad sends'],
                    },
                    {
                        actions: [sendRange(['track-2', 'track-1'], 3), sendRange(['track-3', 'track-2'], 6)],
                        actionLabels: ['Lead sends again', 'Pad sends again'],
                    }
                ).changes.map(({ kind, label }) => [kind, label])
            ).toEqual([
                ['changed', 'Lead sends again'],
                ['changed', 'Pad sends again'],
            ]);
        });

        it('pairs a creation grounded again under a fresh minted id, never reading that id as its object', () => {
            const compressor = (deviceId: string) =>
                ({
                    type: 'addDevice',
                    payload: { trackId: 'track-1', deviceType: 'Compressor', deviceId },
                }) satisfies AppAction;

            expect(
                diff(
                    { actions: [compressor('device-command-1')], actionLabels: ['Compressor'] },
                    { actions: [compressor('device-command-2')], actionLabels: ['Compressor'] }
                ).changes.map(({ kind }) => kind)
            ).toEqual(['changed']);
        });

        it('pairs a placement set that dropped a clip, by the clip both still place', () => {
            const move = (clipId: string, startBeat: number) => ({ clipId, trackId: 'track-1', startBeat });

            expect(
                changedOnly(
                    'moveClips',
                    { moves: [move('clip-1', 4), move('clip-2', 8)] },
                    { moves: [move('clip-1', 4)] }
                ).changes
            ).toEqual([
                {
                    kind: 'changed',
                    actionType: 'moveClips',
                    label: 'After',
                    fields: [
                        {
                            field: 'moves',
                            previous: canonicalJson([move('clip-1', 4), move('clip-2', 8)]),
                            next: canonicalJson([move('clip-1', 4)]),
                        },
                    ],
                },
            ]);
            expect(
                diff(
                    {
                        actions: [
                            { type: 'moveClips', payload: { moves: [move('clip-1', 4), move('clip-2', 8)] } },
                            { type: 'moveClips', payload: { moves: [move('clip-3', 12)] } },
                        ],
                        actionLabels: ['Move verse', 'Move chorus'],
                    },
                    {
                        actions: [
                            { type: 'moveClips', payload: { moves: [move('clip-3', 12), move('clip-4', 16)] } },
                            { type: 'moveClips', payload: { moves: [move('clip-1', 4)] } },
                        ],
                        actionLabels: ['Move chorus', 'Move verse'],
                    }
                ).changes.map(({ kind, label }) => [kind, label])
            ).toEqual([
                ['changed', 'Move chorus'],
                ['changed', 'Move verse'],
            ]);
        });

        it('pairs a track output whose destination changed, by the track it routes', () => {
            expect(
                changedOnly(
                    'setTrackOutput',
                    { trackId: 'track-1', outputId: 'bus-a' },
                    { trackId: 'track-1', outputId: 'bus-b' }
                ).changes
            ).toEqual([
                {
                    kind: 'changed',
                    actionType: 'setTrackOutput',
                    label: 'After',
                    fields: [{ field: 'outputId', previous: 'bus-a', next: 'bus-b' }],
                },
            ]);
        });

        it('pairs a device insert whose position moved, by the track it goes on', () => {
            expect(
                changedOnly(
                    'addDevice',
                    { trackId: 'track-1', deviceType: 'builtin-eq', afterDeviceId: 'device-1' },
                    { trackId: 'track-1', deviceType: 'builtin-eq', afterDeviceId: 'device-2' }
                ).changes
            ).toEqual([
                {
                    kind: 'changed',
                    actionType: 'addDevice',
                    label: 'After',
                    fields: [{ field: 'afterDeviceId', previous: 'device-1', next: 'device-2' }],
                },
            ]);
        });

        it('pairs two automated ranges on one track by the parameter each automates', () => {
            const range = (parameterId: string, value: Record<string, number>) =>
                ({
                    type: 'automateParameterRange',
                    payload: { trackId: 't1', parameterId, range: { section: 'Chorus' }, ...value },
                }) satisfies AppAction;

            expect(
                diff(
                    {
                        actions: [range('gain', { valueDb: -6 }), range('pan', { value: 0.2 })],
                        actionLabels: ['Gain', 'Pan'],
                    },
                    {
                        actions: [range('gain', { valueDb: -9 }), range('pan', { value: 0.3 })],
                        actionLabels: ['Gain', 'Pan'],
                    }
                )
            ).toEqual({
                changes: [
                    {
                        kind: 'changed',
                        actionType: 'automateParameterRange',
                        label: 'Gain',
                        fields: [{ field: 'valueDb', previous: '-6 dB', next: '-9 dB' }],
                    },
                    {
                        kind: 'changed',
                        actionType: 'automateParameterRange',
                        label: 'Pan',
                        fields: [{ field: 'value', previous: '0.2', next: '0.3' }],
                    },
                ],
                unchangedCount: 0,
            });
        });

        it('keeps a lane created for another parameter apart from the one it replaces', () => {
            expect(
                changedOnly(
                    'addAutomationLane',
                    { trackId: 't1', parameterId: 'gain' },
                    { trackId: 't1', parameterId: 'pan' }
                ).changes.map(({ kind }) => kind)
            ).toEqual(['added', 'removed']);
        });

        it('pairs two sends from one track by their bus', () => {
            const send = (busId: string, levelDb: number) =>
                ({ type: 'setSend', payload: { trackId: 'track-1', busId, levelDb } }) satisfies AppAction;

            expect(
                diff(
                    { actions: [send('bus-a', -6), send('bus-b', -12)], actionLabels: ['Send A', 'Send B'] },
                    { actions: [send('bus-b', -9), send('bus-a', -3)], actionLabels: ['Send B', 'Send A'] }
                )
            ).toEqual({
                changes: [
                    {
                        kind: 'changed',
                        actionType: 'setSend',
                        label: 'Send B',
                        fields: [{ field: 'levelDb', previous: '-12 dB', next: '-9 dB' }],
                    },
                    {
                        kind: 'changed',
                        actionType: 'setSend',
                        label: 'Send A',
                        fields: [{ field: 'levelDb', previous: '-6 dB', next: '-3 dB' }],
                    },
                ],
                unchangedCount: 0,
            });
        });
    });

    describe('reports a command on another object as removed and added, never as one command changed', () => {
        function replaced(actionType: string, before: Record<string, unknown>, after: Record<string, unknown>) {
            return diff(
                { actions: [{ type: actionType, payload: before }], actionLabels: ['Before'] },
                { actions: [{ type: actionType, payload: after }], actionLabels: ['After'] }
            );
        }
        const removedAndAdded = (actionType: string) => ({
            changes: [
                { kind: 'added', actionType, label: 'After' },
                { kind: 'removed', actionType, label: 'Before' },
            ],
            unchangedCount: 0,
        });

        it.each([
            [
                'another parameter on the same device',
                'setDeviceParameter',
                { deviceId: 'd1', paramId: 'cutoff', value: 0.5 },
                { deviceId: 'd1', paramId: 'resonance', value: 0.5 },
            ],
            ['another marker', 'removeMarker', { markerId: 'm1' }, { markerId: 'm2' }],
            [
                'another marker recolored',
                'setMarkerColor',
                { markerId: 'm1', color: 'red' },
                { markerId: 'm2', color: 'red' },
            ],
            ['another section', 'removeSection', { sectionId: 's1' }, { sectionId: 's2' }],
            [
                'another section renamed alike',
                'renameSection',
                { sectionId: 's1', name: 'Hook' },
                { sectionId: 's2', name: 'Hook' },
            ],
            ['another clip set sharing no clip', 'glueClips', { clipIds: ['a', 'b'] }, { clipIds: ['c', 'd'] }],
            [
                'a sidechain from another source',
                'addSidechainRoute',
                { sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'comp' },
                { sourceTrackId: 'snare', targetTrackId: 'bass', targetDeviceId: 'comp' },
            ],
        ] as const)('%s', (_case, actionType, before, after) => {
            expect(replaced(actionType, before, after)).toEqual(removedAndAdded(actionType));
        });

        it('pairs a section rename by the section it resolved to, so a new label reads as changed', () => {
            expect(
                diff(
                    {
                        actions: [{ type: 'renameSection', payload: { sectionId: 's1', name: 'Chorus' } }],
                        actionLabels: ['Rename to Chorus'],
                    },
                    {
                        actions: [{ type: 'renameSection', payload: { sectionId: 's1', name: 'Bridge' } }],
                        actionLabels: ['Rename to Bridge'],
                    }
                )
            ).toEqual({
                changes: [
                    {
                        kind: 'changed',
                        actionType: 'renameSection',
                        label: 'Rename to Bridge',
                        fields: [{ field: 'name', previous: 'Chorus', next: 'Bridge' }],
                    },
                ],
                unchangedCount: 0,
            });
        });

        it('pairs neither of two renames of one clip with the one rename they could replace', () => {
            const rename = (name: string) => ({ type: 'renameClip', payload: { clipId: 'clip-c', name } });

            expect(
                diff(
                    { actions: [rename('Verse')], actionLabels: ['Rename to Verse'] },
                    {
                        actions: [rename('Chorus'), rename('Bridge')],
                        actionLabels: ['Rename to Chorus', 'Rename to Bridge'],
                    }
                )
            ).toEqual({
                changes: [
                    { kind: 'added', actionType: 'renameClip', label: 'Rename to Chorus' },
                    { kind: 'added', actionType: 'renameClip', label: 'Rename to Bridge' },
                    { kind: 'removed', actionType: 'renameClip', label: 'Rename to Verse' },
                ],
                unchangedCount: 0,
            });
        });
    });
});
