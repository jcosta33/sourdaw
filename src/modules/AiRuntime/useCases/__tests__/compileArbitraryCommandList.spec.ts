import { describe, expect, it } from 'vitest';

import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { validateArbitraryCommandListEvidence } from '../validateArbitraryCommandListEvidence';

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

function contextWithOwnedDeviceParameters() {
    return {
        ...context,
        tracks: context.tracks.map((track) => {
            if (track.id === 'track-kick') {
                return {
                    ...track,
                    deviceCount: 1,
                    devices: [
                        {
                            id: 'device-kick',
                            name: 'Kick Compressor',
                            type: 'builtin-compressor',
                            bypassed: false,
                            parameters: [
                                {
                                    id: 'parameter-kick-threshold',
                                    name: 'Threshold',
                                    type: 'float' as const,
                                    value: -12,
                                    minValue: -60,
                                    maxValue: 0,
                                    unit: 'dB',
                                },
                            ],
                        },
                    ],
                };
            }
            return {
                ...track,
                deviceCount: 1,
                devices: [
                    {
                        id: 'device-hat',
                        name: 'Hat Compressor',
                        type: 'builtin-compressor',
                        bypassed: false,
                        parameters: [
                            {
                                id: 'parameter-hat-threshold',
                                name: 'Threshold',
                                type: 'float' as const,
                                value: -18,
                                minValue: -60,
                                maxValue: 0,
                                unit: 'dB',
                            },
                        ],
                    },
                ],
            };
        }),
    };
}

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

    it('admits a batch-local bus target only through its declared producer dependency', () => {
        const compile = (dependsOn: string[] | undefined) =>
            compileArbitraryCommandList({
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
                                    {
                                        id: 'create-drum-bus',
                                        name: 'createBus',
                                        arguments: { name: 'Drum Bus', binding: 'drum-bus' },
                                    },
                                    {
                                        id: 'route-kick',
                                        name: 'setTrackOutput',
                                        arguments: { outputId: '$drum-bus' },
                                        selector: {
                                            targetArgument: 'trackId',
                                            entity: 'track',
                                            where: { name: 'Kick' },
                                            quantity: { unit: 'targets', exactly: 1 },
                                        },
                                        dependsOn,
                                    },
                                ],
                            },
                        },
                    },
                ],
            });

        const accepted = compile(['create-drum-bus']);
        expect(accepted).toMatchObject({
            status: 'accepted',
            calls: [
                {
                    arguments: {
                        commands: [
                            { name: 'createBus', arguments: { name: 'Drum Bus', binding: 'drum-bus' } },
                            {
                                name: 'setTrackOutput',
                                arguments: { trackId: 'track-kick', outputId: '$drum-bus' },
                            },
                        ],
                    },
                },
            ],
        });
        if (accepted.status !== 'accepted') {
            throw new Error('Expected the valid command list to compile');
        }
        if (accepted.compilerEvidence === undefined) {
            throw new Error('Expected accepted command compilation to retain compiler evidence');
        }
        expect(
            validateArbitraryCommandListEvidence({
                evidence: accepted.compilerEvidence,
                calls: accepted.compilerEvidence.commands,
                context,
                revision: 'revision-1',
            })
        ).toMatchObject({ status: 'accepted' });
        expect(compile(undefined)).toMatchObject({
            status: 'rejected',
            reason: 'Batch-local target $drum-bus requires an earlier declared producer dependency.',
        });
    });

    it('canonicalizes idempotent selector repetition into one guarded write per stable target', () => {
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
                        { name: 'muteTrack', arguments: { muted: true, trackId: 'track-hat' } },
                    ],
                },
            },
        ]);
        expect(result.evidence).toEqual([
            expect.objectContaining({ stableIds: ['track-kick', 'track-hat'], protectedExclusions: [] }),
        ]);
        expect(result.compilerEvidence?.items).toEqual([
            expect.objectContaining({
                canonicalStableIds: ['track-kick', 'track-hat'],
                declaredCommandCount: 4,
                omittedCommandCount: 2,
            }),
        ]);
    });

    it('canonicalizes duplicate idempotent items while retaining their declared dependency identity', () => {
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
                                { id: 'mute-kick', name: 'muteTrack', arguments: { muted: true }, selector },
                                {
                                    id: 'mute-kick-again',
                                    name: 'muteTrack',
                                    arguments: { muted: true },
                                    selector,
                                    dependsOn: ['mute-kick'],
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
        expect(result.compilerEvidence?.commands).toEqual([
            { name: 'muteTrack', arguments: { muted: true, trackId: 'track-kick' } },
        ]);
        expect(result.compilerEvidence?.items).toEqual([
            expect.objectContaining({ itemId: 'mute-kick', commandStart: 0, commandCount: 1 }),
            expect.objectContaining({
                itemId: 'mute-kick-again',
                commandStart: 1,
                commandCount: 0,
                declaredCommandCount: 1,
                omittedCommandCount: 1,
            }),
        ]);
    });

    it('rejects target writes whose different values have no declared local composition', () => {
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
                                { id: 'mute-kick', name: 'muteTrack', arguments: { muted: true }, selector },
                                {
                                    id: 'unmute-kick',
                                    name: 'muteTrack',
                                    arguments: { muted: false },
                                    selector,
                                    dependsOn: ['mute-kick'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for muteTrack on track-kick are not safely composable.',
        });
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

    it('rejects forged or stale compiler evidence before it can bypass prompt grounding', () => {
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
                                {
                                    id: 'mute-kick',
                                    name: 'muteTrack',
                                    arguments: { muted: true },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { name: 'Kick' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result.status).toBe('accepted');
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        expect(
            validateArbitraryCommandListEvidence({
                evidence: result.compilerEvidence,
                calls: result.compilerEvidence.commands,
                context,
                revision: 'revision-2',
            }).status
        ).toBe('rejected');
        expect(
            validateArbitraryCommandListEvidence({
                evidence: result.compilerEvidence,
                calls: result.compilerEvidence.commands,
                context: {
                    ...context,
                    tracks: context.tracks.map((track) =>
                        track.id === 'track-kick' ? { ...track, muted: true } : track
                    ),
                },
                revision: 'revision-1',
            }).status
        ).toBe('rejected');
        expect(
            validateArbitraryCommandListEvidence({
                evidence: {
                    ...result.compilerEvidence,
                    commands: [
                        ...result.compilerEvidence.commands,
                        { name: 'muteTrack', arguments: { trackId: 'track-hat', muted: true } },
                    ],
                },
                calls: result.compilerEvidence.commands,
                context,
                revision: 'revision-1',
            }).status
        ).toBe('rejected');
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

    it('rejects contradictory output writes to the same selected track', () => {
        const routingContext = {
            ...context,
            tracks: [
                ...context.tracks,
                { ...context.tracks[0]!, id: 'bus-a', name: 'Bus A', kind: 'bus', devices: [] },
                { ...context.tracks[0]!, id: 'bus-b', name: 'Bus B', kind: 'bus', devices: [] },
            ],
        };
        const selector = {
            targetArgument: 'trackId',
            entity: 'track',
            where: { name: 'Kick' },
            quantity: { unit: 'targets', exactly: 1 },
        };

        const result = compileArbitraryCommandList({
            context: routingContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['bus-a', 'track-kick', 'bus-b']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                { id: 'route-a', name: 'setTrackOutput', arguments: { outputId: 'bus-a' }, selector },
                                {
                                    id: 'route-b',
                                    name: 'setTrackOutput',
                                    arguments: { outputId: 'bus-b' },
                                    selector,
                                    dependsOn: ['route-a'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for setTrackOutput on track-kick are not safely composable.',
        });
    });

    it('rejects a device parameter that belongs to a different device during compilation', () => {
        const deviceContext = contextWithOwnedDeviceParameters();
        const result = compileArbitraryCommandList({
            context: deviceContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['device-kick', 'parameter-hat-threshold']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'set-kick-threshold',
                                    name: 'setDeviceParameter',
                                    arguments: { paramId: 'parameter-hat-threshold', value: -8 },
                                    selector: {
                                        targetArgument: 'deviceId',
                                        entity: 'device',
                                        where: { name: 'Kick Compressor' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Direct command target paramId is outside the command capability contract.',
        });
    });

    it('rejects compiler evidence that swaps a device parameter to a different owner', () => {
        const deviceContext = contextWithOwnedDeviceParameters();
        const result = compileArbitraryCommandList({
            context: deviceContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['device-kick', 'parameter-kick-threshold']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'set-kick-threshold',
                                    name: 'setDeviceParameter',
                                    arguments: { paramId: 'parameter-kick-threshold', value: -8 },
                                    selector: {
                                        targetArgument: 'deviceId',
                                        entity: 'device',
                                        where: { name: 'Kick Compressor' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result.status).toBe('accepted');
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            throw new Error('Expected owned device parameter compilation evidence');
        }
        const calls = result.compilerEvidence.commands.map((command) => ({
            ...command,
            arguments:
                command.name === 'setDeviceParameter'
                    ? { ...command.arguments, paramId: 'parameter-hat-threshold' }
                    : command.arguments,
        }));

        expect(
            validateArbitraryCommandListEvidence({
                evidence: { ...result.compilerEvidence, commands: calls },
                calls,
                context: deviceContext,
                revision: 'revision-1',
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Structured command compiler evidence target scope is invalid.',
        });
    });

    it.each([
        {
            name: 'armTrack',
            targetArgument: 'trackId',
            arguments_: { armed: true },
            ineligibleKind: 'vca',
            eligibleKind: 'audio',
        },
        {
            name: 'addDevice',
            targetArgument: 'trackId',
            arguments_: { deviceType: 'builtin-eq' },
            ineligibleKind: 'vca',
            eligibleKind: 'audio',
        },
        {
            name: 'setTrackOutput',
            targetArgument: 'outputId',
            arguments_: {},
            ineligibleKind: 'audio',
            eligibleKind: 'bus',
        },
        { name: 'addSend', targetArgument: 'busId', arguments_: {}, ineligibleKind: 'audio', eligibleKind: 'bus' },
    ] as const)('rejects an ineligible $name selector while accepting its canonical capability kind', (entry) => {
        const compile = (kind: string) =>
            compileArbitraryCommandList({
                context: {
                    ...context,
                    tracks: [{ ...context.tracks[0]!, id: 'target', name: 'Target', kind }],
                },
                revision: 'revision-1',
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan: plan(['target']),
                            list: {
                                schemaVersion: 1,
                                items: [
                                    {
                                        id: 'capability-target',
                                        name: entry.name,
                                        arguments: entry.arguments_,
                                        selector: {
                                            targetArgument: entry.targetArgument,
                                            entity: 'track',
                                            where: { name: 'Target' },
                                            quantity: { unit: 'targets', exactly: 1 },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            });

        expect(compile(entry.ineligibleKind)).toMatchObject({
            status: 'rejected',
            reason: 'Bulk selector resolved a target outside the command capability contract.',
        });
        expect(compile(entry.eligibleKind)).toMatchObject({ status: 'accepted' });
    });
});
