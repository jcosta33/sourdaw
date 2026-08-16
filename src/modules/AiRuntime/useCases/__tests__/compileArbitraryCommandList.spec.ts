import { describe, expect, it } from 'vitest';

import { compileArbitraryCommandList } from '../compileArbitraryCommandList';

const context = {
    tempo: 120,
    timeSignature: [4, 4] as [number, number],
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
        {
            id: 'track-kick',
            name: 'Kick',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read' as const,
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
        },
        {
            id: 'track-hat',
            name: 'Hat',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 1,
            pan: 0,
            automationMode: 'read' as const,
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange' as const,
    playheadPosition: 0,
};

const plan = (targetIds: string[], protectedTargetIds: string[] = []) => ({
    semantic: { classification: 'simple', uncertainty: [] },
    objective: 'Mute the requested drum tracks.',
    constraints: [],
    scope: { targetIds, targetRanges: [], protectedTargetIds, protectedRanges: [] },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: [],
    stoppingConditions: [],
});

describe('compileArbitraryCommandList', () => {
    it('preserves explicit order and dependencies for non-targeted catalog commands', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan([]),
                        list: {
                            schemaVersion: 1,
                            items: [
                                { id: 'tempo', name: 'setTempo', arguments: { bpm: 128 } },
                                {
                                    id: 'meter',
                                    name: 'setTimeSignature',
                                    arguments: { numerator: 3, denominator: 4 },
                                    dependsOn: ['tempo'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted') {
            return;
        }
        expect(result.calls[0]?.arguments.commands).toEqual([
            { name: 'setTempo', arguments: { bpm: 128 } },
            { name: 'setTimeSignature', arguments: { numerator: 3, denominator: 4 } },
        ]);
    });

    it('resolves an ordered bulk selector once into stable IDs and locally expands its repetition', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'track-hat']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'mute-drums',
                                    name: 'muteTrack',
                                    arguments: { muted: true },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { kind: 'audio' },
                                        condition: { field: 'muted', equals: false },
                                        quantity: { unit: 'targets', exactly: 2 },
                                    },
                                    repeat: { count: 2 },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted', snapshotRevision: 'revision-1' });
        if (result.status !== 'accepted') {
            return;
        }
        expect(result.calls).toEqual([
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: plan(['track-kick', 'track-hat']),
                    commands: [
                        { name: 'muteTrack', arguments: { muted: true, trackId: 'track-kick' } },
                        { name: 'muteTrack', arguments: { muted: true, trackId: 'track-kick' } },
                        { name: 'muteTrack', arguments: { muted: true, trackId: 'track-hat' } },
                        { name: 'muteTrack', arguments: { muted: true, trackId: 'track-hat' } },
                    ],
                },
            },
        ]);
        expect(result.evidence).toEqual([
            expect.objectContaining({ stableIds: ['track-kick', 'track-hat'], protectedExclusions: [] }),
        ]);
    });

    it('excludes protected targets before it records a stable, revision-bearing scope', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-hat'], ['track-kick']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'mute-unprotected',
                                    name: 'muteTrack',
                                    arguments: { muted: true },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted', snapshotRevision: 'revision-1' });
        if (result.status !== 'accepted') {
            return;
        }
        expect(result.evidence[0]).toMatchObject({
            stableIds: ['track-hat'],
            protectedExclusions: ['track-kick'],
            preconditions: [expect.objectContaining({ stableId: 'track-hat' })],
        });
    });

    it.each([
        ['an unbounded selector', { selector: { targetArgument: 'trackId', entity: 'track' } }],
        [
            'a protected target',
            {
                selector: {
                    targetArgument: 'trackId',
                    entity: 'track',
                    quantity: { unit: 'targets', exactly: 1 },
                },
            },
        ],
    ])('rejects %s before it can enter the command bridge', (_label, item) => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick'], ['track-kick']),
                        list: {
                            schemaVersion: 1,
                            items: [{ id: 'one', name: 'muteTrack', arguments: { muted: true }, ...item }],
                        },
                    },
                },
            ],
        });

        expect(result.status).toBe('rejected');
    });

    it.each([
        [
            'a cycle',
            [
                { id: 'first', name: 'muteTrack', arguments: { muted: true }, dependsOn: ['second'] },
                { id: 'second', name: 'muteTrack', arguments: { muted: true }, dependsOn: ['first'] },
            ],
        ],
        [
            'a duplicate item ID',
            [
                { id: 'same', name: 'muteTrack', arguments: { muted: true } },
                { id: 'same', name: 'muteTrack', arguments: { muted: true } },
            ],
        ],
    ])('rejects %s before command materialization', (_label, items) => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: { plan: plan([]), list: { schemaVersion: 1, items } },
                },
            ],
        });

        expect(result.status).toBe('rejected');
    });

    it('rejects a later destructive command that contradicts an earlier target write', () => {
        const selector = {
            targetArgument: 'trackId',
            entity: 'track',
            where: { name: 'Kick' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                { id: 'mute', name: 'muteTrack', arguments: { muted: true }, selector },
                                {
                                    id: 'remove',
                                    name: 'removeTrack',
                                    arguments: {},
                                    selector,
                                    dependsOn: ['mute'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result.status).toBe('rejected');
    });
});
