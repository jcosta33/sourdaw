import { afterEach, describe, expect, it } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    commandBatchPreviewPort,
    commandTrackDefaultsPort,
    compilePartialCommandBatchAcceptance,
    executeVersionedCommandBatchEnvelope,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';

import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { materializeBatchLocalActionIdentities } from '../agentReference/materializeBatchLocalActionIdentities';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { planAgentRun } from '../planAgentRun';
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

const deviceParameter = (id: string) => ({
    id,
    name: id,
    type: 'float' as const,
    value: 0,
    minValue: -100,
    maxValue: 100,
    unit: 'unitless',
});

describe('compileArbitraryCommandList', () => {
    afterEach(() => {
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandBatchPreviewPort.setProvider(null);
        commandTrackDefaultsPort.setTrackColorProvider(null);
    });

    it('carries every direct secondary target through exact compiler and command-batch planning scope', () => {
        const routingContext = {
            ...context,
            tracks: [
                ...context.tracks.map((track) => ({ ...track, outputId: 'master' })),
                {
                    ...context.tracks[0]!,
                    id: 'track-mix-bus',
                    name: 'Mix Bus',
                    kind: 'bus',
                    outputId: 'master',
                },
            ],
        };
        const result = compileArbitraryCommandList({
            context: routingContext,
            revision: 'revision-routing',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-mix-bus', 'track-kick']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'route-kick',
                                    name: 'setTrackOutput',
                                    arguments: { outputId: 'track-mix-bus' },
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

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        expect(result.compilerEvidence.proposalScope.targetIds).toEqual(['track-mix-bus', 'track-kick']);
        expect(
            validateArbitraryCommandListEvidence({
                evidence: result.compilerEvidence,
                calls: result.compilerEvidence.commands,
                context: routingContext,
                revision: 'revision-routing',
            })
        ).toMatchObject({
            status: 'accepted',
            targetOverridesByCallIndex: new Map([
                [
                    0,
                    [
                        {
                            argument: 'outputId',
                            capability: 'output',
                            cardinality: 'one',
                            stableIds: ['track-mix-bus'],
                        },
                        {
                            argument: 'trackId',
                            capability: 'routable-source',
                            cardinality: 'one',
                            stableIds: ['track-kick'],
                        },
                    ],
                ],
            ]),
        });
        expect(
            validateArbitraryCommandListEvidence({
                evidence: {
                    ...result.compilerEvidence,
                    items: result.compilerEvidence.items.map((item) => ({ ...item, directTargets: undefined })),
                },
                calls: result.compilerEvidence.commands,
                context: routingContext,
                revision: 'revision-routing',
            })
        ).toMatchObject({ status: 'rejected', reason: expect.stringContaining('direct targets') });

        const action = {
            type: 'setTrackOutput' as const,
            payload: {
                trackId: 'track-kick',
                outputId: 'track-mix-bus',
                expectedOutputId: 'master',
            },
        };
        registerHandlerMap(getArrangementHandlers());
        const compiledExecution = compilePlannedActionCommandBatch({
            actions: [action],
            actionLabels: ['Route Kick to Mix Bus'],
            autoCommit: false,
            context: routingContext,
            group: { groupId: 'group-route-kick', groupLabel: 'Route Kick' },
            intent: 'Route Kick to Mix Bus',
            projectRevision: 'revision-routing',
            runId: 'run-route-kick',
        });
        expect(compiledExecution.commandBatch.authority.scope.targetIds).toEqual(['track-kick', 'track-mix-bus']);
        expect(
            planAgentRun({
                request: 'Route Kick to Mix Bus',
                revision: 'revision-routing',
                actions: [action],
                actionLabels: ['Route Kick to Mix Bus'],
                scope: {
                    ...compiledExecution.commandBatch.authority.scope,
                    targetIds: [...compiledExecution.commandBatch.authority.scope.targetIds],
                    targetRanges: [...compiledExecution.commandBatch.authority.scope.targetRanges],
                    protectedTargetIds: [...compiledExecution.commandBatch.authority.scope.protectedTargetIds],
                    protectedRanges: [...compiledExecution.commandBatch.authority.scope.protectedRanges],
                },
                grants: {
                    ...compiledExecution.commandBatch.authority.grants,
                    allowedOperationPrefixes: [
                        ...compiledExecution.commandBatch.authority.grants.allowedOperationPrefixes,
                    ],
                },
                budgets: { limits: compiledExecution.commandBatch.authority.budgets, consumed: {} },
                requiresConfirmation: true,
                providerProposal: {
                    semantic: { classification: 'simple', uncertainty: [] },
                    objective: 'Route Kick to Mix Bus',
                    constraints: [],
                    scope: result.compilerEvidence.proposalScope,
                    capabilityIds: ['setTrackOutput'],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: [],
                    stoppingConditions: [],
                },
                requireProviderProposal: true,
            })
        ).toMatchObject({ status: 'planned' });
    });

    it('rejects an invalid direct secondary target before command materialization', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-routing',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'missing-output']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'route-kick',
                                    name: 'setTrackOutput',
                                    arguments: { outputId: 'missing-output' },
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

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Direct command target outputId is outside the command capability contract.',
        });
    });

    it('validates and records a direct many-target secondary argument exactly once', () => {
        const sendContext = {
            ...context,
            tracks: [
                ...context.tracks,
                {
                    ...context.tracks[0]!,
                    id: 'track-send-bus',
                    name: 'Send Bus',
                    kind: 'bus',
                },
            ],
        };
        const result = compileArbitraryCommandList({
            context: sendContext,
            revision: 'revision-send',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'track-hat', 'track-send-bus']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'lower-sends',
                                    name: 'automateSendRange',
                                    arguments: {
                                        trackIds: ['track-kick', 'track-hat'],
                                        sectionName: 'Chorus',
                                        reductionDb: 3,
                                    },
                                    selector: {
                                        targetArgument: 'busId',
                                        entity: 'track',
                                        where: { name: 'Send Bus' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        expect(result.compilerEvidence.items[0]?.directTargets).toEqual([
            {
                argument: 'trackIds',
                capability: 'routable-source',
                cardinality: 'many',
                stableIds: ['track-kick', 'track-hat'],
            },
        ]);
        expect(
            validateArbitraryCommandListEvidence({
                evidence: result.compilerEvidence,
                calls: result.compilerEvidence.commands,
                context: sendContext,
                revision: 'revision-send',
            }).status
        ).toBe('accepted');
    });

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

    it('rejects contradictory writes to the same singleton project resource', () => {
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
                                { id: 'tempo-up', name: 'setTempo', arguments: { bpm: 128 } },
                                {
                                    id: 'tempo-up-again',
                                    name: 'setTempo',
                                    arguments: { bpm: 130 },
                                    dependsOn: ['tempo-up'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for setTempo on singleton resource are not safely composable.',
        });
    });

    it('composes independent child creation under the same parent resources', () => {
        const automationContext = {
            ...context,
            automationLanes: [
                {
                    id: 'lane-kick-gain',
                    trackId: 'track-kick',
                    parameterId: 'gain',
                    name: 'Kick Gain',
                    enabled: true,
                    minValue: 0,
                    maxValue: 1,
                    points: [],
                },
            ],
            adjustmentLayers: [
                {
                    id: 'layer-kick-air',
                    name: 'Kick Air',
                    effectType: 'eq' as const,
                    parameters: [],
                    affectedTrackIds: ['track-kick'],
                    insertionIndex: 0,
                    regions: [],
                    enabled: true,
                    mix: 1,
                    color: '#ffffff',
                },
            ],
        };
        const result = compileArbitraryCommandList({
            context: automationContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'lane-kick-gain', 'layer-kick-air']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'first-clip',
                                    name: 'addClip',
                                    arguments: { startBeat: 0, endBeat: 4, name: 'First' },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { name: 'Kick' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                                {
                                    id: 'second-clip',
                                    name: 'addClip',
                                    arguments: { startBeat: 4, endBeat: 8, name: 'Second' },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { name: 'Kick' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['first-clip'],
                                },
                                {
                                    id: 'first-point',
                                    name: 'addAutomationPoint',
                                    arguments: { beat: 1, value: 0.25 },
                                    selector: {
                                        targetArgument: 'laneId',
                                        entity: 'automation-lane',
                                        where: { name: 'Kick Gain' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['second-clip'],
                                },
                                {
                                    id: 'second-point',
                                    name: 'addAutomationPoint',
                                    arguments: { beat: 2, value: 0.75 },
                                    selector: {
                                        targetArgument: 'laneId',
                                        entity: 'automation-lane',
                                        where: { name: 'Kick Gain' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['first-point'],
                                },
                                {
                                    id: 'first-region',
                                    name: 'addAdjustmentRegion',
                                    arguments: {
                                        startBeat: 0,
                                        endBeat: 4,
                                        blend: 1,
                                        fadeInBeats: 0,
                                        fadeOutBeats: 0,
                                    },
                                    selector: {
                                        targetArgument: 'layerId',
                                        entity: 'adjustment-layer',
                                        where: { name: 'Kick Air' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['second-point'],
                                },
                                {
                                    id: 'second-region',
                                    name: 'addAdjustmentRegion',
                                    arguments: {
                                        startBeat: 4,
                                        endBeat: 8,
                                        blend: 0.5,
                                        fadeInBeats: 0,
                                        fadeOutBeats: 0,
                                    },
                                    selector: {
                                        targetArgument: 'layerId',
                                        entity: 'adjustment-layer',
                                        where: { name: 'Kick Air' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['first-region'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
    });

    it('keys automation lane creation by track and parameter', () => {
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
                                    id: 'gain-lane',
                                    name: 'addAutomationLane',
                                    arguments: { parameterId: 'gain' },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { name: 'Kick' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                                {
                                    id: 'pan-lane',
                                    name: 'addAutomationLane',
                                    arguments: { parameterId: 'pan' },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { name: 'Kick' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['gain-lane'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
    });

    it('keys sidechain creation by source and materialized target device', () => {
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
                                    id: 'route-to-first-compressor',
                                    name: 'addSidechainRoute',
                                    arguments: { targetTrackId: 'track-hat', targetDeviceId: 'compressor-a' },
                                    selector: {
                                        targetArgument: 'sourceTrackId',
                                        entity: 'track',
                                        where: { name: 'Kick' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                                {
                                    id: 'route-to-second-compressor',
                                    name: 'addSidechainRoute',
                                    arguments: { targetTrackId: 'track-hat', targetDeviceId: 'compressor-b' },
                                    selector: {
                                        targetArgument: 'sourceTrackId',
                                        entity: 'track',
                                        where: { name: 'Kick' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['route-to-first-compressor'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
    });

    it('uses the owning target track until an omitted sidechain device is materialized', () => {
        const routeContext = {
            ...context,
            tracks: [
                ...context.tracks,
                {
                    ...context.tracks[0]!,
                    id: 'track-bass',
                    name: 'Bass',
                    deviceCount: 1,
                    devices: [
                        {
                            id: 'compressor-bass',
                            name: 'Bass Compressor',
                            type: 'builtin-sidechain-compressor',
                            bypassed: false,
                            parameters: [],
                        },
                    ],
                },
            ],
        };
        const selector = {
            targetArgument: 'sourceTrackId',
            entity: 'track',
            where: { name: 'Kick' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: routeContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'track-hat', 'track-bass']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'route-to-hat-compressor',
                                    name: 'addSidechainRoute',
                                    arguments: { targetTrackId: 'track-hat' },
                                    selector,
                                },
                                {
                                    id: 'route-to-bass-compressor',
                                    name: 'addSidechainRoute',
                                    arguments: { targetTrackId: 'track-bass' },
                                    selector,
                                    dependsOn: ['route-to-hat-compressor'],
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
            {
                name: 'addSidechainRoute',
                arguments: { sourceTrackId: 'track-kick', targetTrackId: 'track-hat' },
            },
            {
                name: 'addSidechainRoute',
                arguments: { sourceTrackId: 'track-kick', targetTrackId: 'track-bass' },
            },
        ]);
    });

    it('rejects duplicate sidechain creation for one source and materialized target device', () => {
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
                                    id: 'route-device',
                                    name: 'addSidechainRoute',
                                    arguments: { targetTrackId: 'track-hat', targetDeviceId: 'compressor-a' },
                                    selector: {
                                        targetArgument: 'sourceTrackId',
                                        entity: 'track',
                                        where: { name: 'Kick' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                                {
                                    id: 'reroute-device',
                                    name: 'addSidechainRoute',
                                    arguments: { targetTrackId: 'track-hat', targetDeviceId: 'compressor-a' },
                                    selector: {
                                        targetArgument: 'sourceTrackId',
                                        entity: 'track',
                                        where: { name: 'Kick' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['route-device'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for addSidechainRoute on track-kick are not safely composable.',
        });
    });

    it('rejects mixed explicit and implicit sidechain routes to the same uniquely materialized device', () => {
        const routeContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-hat'
                    ? {
                          ...track,
                          deviceCount: 1,
                          devices: [
                              {
                                  id: 'compressor-hat',
                                  name: 'Hat Compressor',
                                  type: 'builtin-sidechain-compressor',
                                  bypassed: false,
                                  parameters: [deviceParameter('threshold')],
                              },
                          ],
                      }
                    : track
            ),
        };
        const selector = {
            targetArgument: 'sourceTrackId',
            entity: 'track',
            where: { name: 'Kick' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: routeContext,
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
                                    id: 'route-by-device',
                                    name: 'addSidechainRoute',
                                    arguments: {
                                        targetTrackId: 'track-hat',
                                        targetDeviceId: 'compressor-hat',
                                    },
                                    selector,
                                },
                                {
                                    id: 'route-by-track',
                                    name: 'addSidechainRoute',
                                    arguments: { targetTrackId: 'track-hat' },
                                    selector,
                                    dependsOn: ['route-by-device'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for addSidechainRoute on track-kick are not safely composable.',
        });
    });

    it('rejects duplicate sidechain creation for one source and unmaterialized target track', () => {
        const selector = {
            targetArgument: 'sourceTrackId',
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
                                {
                                    id: 'route-track',
                                    name: 'addSidechainRoute',
                                    arguments: { targetTrackId: 'track-hat' },
                                    selector,
                                },
                                {
                                    id: 'reroute-track',
                                    name: 'addSidechainRoute',
                                    arguments: { targetTrackId: 'track-hat' },
                                    selector,
                                    dependsOn: ['route-track'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for addSidechainRoute on track-kick are not safely composable.',
        });
    });

    it.each(['add-first', 'remove-first'] as const)(
        'rejects inverse sidechain-route writes after normalizing the route when %s',
        (order) => {
            const routeContext = {
                ...context,
                sidechainRoutes: [
                    {
                        id: 'route-kick-hat',
                        sourceTrackId: 'track-kick',
                        targetTrackId: 'track-hat',
                        targetDeviceId: 'compressor-hat',
                        targetParameterId: 'sidechain',
                        gain: 1,
                    },
                ],
                tracks: context.tracks.map((track) =>
                    track.id === 'track-hat'
                        ? {
                              ...track,
                              deviceCount: 1,
                              devices: [
                                  {
                                      id: 'compressor-hat',
                                      name: 'Hat Compressor',
                                      type: 'builtin-sidechain-compressor',
                                      bypassed: false,
                                      parameters: [deviceParameter('threshold')],
                                  },
                              ],
                          }
                        : track
                ),
            };
            const selector = {
                targetArgument: 'sourceTrackId',
                entity: 'track' as const,
                where: { name: 'Kick' },
                quantity: { unit: 'targets' as const, exactly: 1 },
            };
            const add = {
                id: 'add-route',
                name: 'addSidechainRoute',
                arguments: { targetTrackId: 'track-hat', targetDeviceId: 'compressor-hat' },
                selector,
            };
            const remove = {
                id: 'remove-route',
                name: 'removeSidechainRoute',
                arguments: { targetTrackId: 'track-hat' },
                selector,
            };
            const items =
                order === 'add-first'
                    ? [add, { ...remove, dependsOn: ['add-route'] }]
                    : [remove, { ...add, dependsOn: ['remove-route'] }];

            const result = compileArbitraryCommandList({
                context: routeContext,
                revision: 'revision-sidechain-route',
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan: plan(['track-kick', 'track-hat']),
                            list: { schemaVersion: 1, items },
                        },
                    },
                ],
            });

            expect(result).toEqual({
                status: 'rejected',
                reason: 'Structured command list contains contradictory mutation resources.',
            });
        }
    );

    it('rejects contradictory edits of the same exact marker reference while composing distinct markers', () => {
        const contradictory = compileArbitraryCommandList({
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
                                {
                                    id: 'color-verse-blue',
                                    name: 'setMarkerColor',
                                    arguments: { beat: 4, name: 'Verse', color: 'blue' },
                                },
                                {
                                    id: 'color-verse-red',
                                    name: 'setMarkerColor',
                                    arguments: { beat: 4, name: 'Verse', color: 'red' },
                                    dependsOn: ['color-verse-blue'],
                                },
                            ],
                        },
                    },
                },
            ],
        });
        const distinct = compileArbitraryCommandList({
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
                                {
                                    id: 'color-verse',
                                    name: 'setMarkerColor',
                                    arguments: { beat: 4, name: 'Verse', color: 'blue' },
                                },
                                {
                                    id: 'color-chorus',
                                    name: 'setMarkerColor',
                                    arguments: { beat: 16, name: 'Chorus', color: 'red' },
                                    dependsOn: ['color-verse'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(contradictory).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for setMarkerColor on 4,Verse are not safely composable.',
        });
        expect(distinct).toMatchObject({ status: 'accepted' });
    });

    it('rejects a destructive marker mutation after a compatible cross-action write to the same marker', () => {
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
                                {
                                    id: 'color-verse',
                                    name: 'setMarkerColor',
                                    arguments: { beat: 4, name: 'Verse', color: 'blue' },
                                },
                                {
                                    id: 'remove-verse',
                                    name: 'removeMarker',
                                    arguments: { beat: 4, name: 'Verse' },
                                    dependsOn: ['color-verse'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command list contains contradictory mutation resources.',
        });

        const distinct = compileArbitraryCommandList({
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
                                {
                                    id: 'color-verse',
                                    name: 'setMarkerColor',
                                    arguments: { beat: 4, name: 'Verse', color: 'blue' },
                                },
                                {
                                    id: 'remove-chorus',
                                    name: 'removeMarker',
                                    arguments: { beat: 16, name: 'Chorus' },
                                    dependsOn: ['color-verse'],
                                },
                            ],
                        },
                    },
                },
            ],
        });
        expect(distinct).toMatchObject({ status: 'accepted' });
    });

    it('composes distinct sends while rejecting destructive aliases of the same send in either order', () => {
        const sendContext = {
            ...context,
            tracks: [
                ...context.tracks,
                { ...context.tracks[0]!, id: 'bus-one', name: 'Bus One', kind: 'bus' },
                { ...context.tracks[0]!, id: 'bus-two', name: 'Bus Two', kind: 'bus' },
            ],
        };
        const sendItem = (id: string, busName: string) => ({
            id,
            name: 'setSend',
            arguments: { trackId: 'track-kick', level: 0.5 },
            selector: {
                targetArgument: 'busId',
                entity: 'track',
                where: { name: busName },
                quantity: { unit: 'targets', exactly: 1 },
            },
        });
        const removeItem = (id: string, busName: string) => ({
            id,
            name: 'removeSend',
            arguments: { trackId: 'track-kick' },
            selector: {
                targetArgument: 'busId',
                entity: 'track',
                where: { name: busName },
                quantity: { unit: 'targets', exactly: 1 },
            },
        });
        const compile = (items: readonly Record<string, unknown>[], targetIds: string[]) =>
            compileArbitraryCommandList({
                context: sendContext,
                revision: 'revision-send-resources',
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: { plan: plan(targetIds), list: { schemaVersion: 1, items } },
                    },
                ],
            });

        expect(
            compile(
                [
                    sendItem('set-bus-one', 'Bus One'),
                    { ...removeItem('remove-bus-two', 'Bus Two'), dependsOn: ['set-bus-one'] },
                ],
                ['bus-one', 'track-kick', 'bus-two']
            )
        ).toMatchObject({ status: 'accepted' });

        for (const order of ['set-first', 'remove-first'] as const) {
            const set = sendItem('set-bus-one', 'Bus One');
            const remove = removeItem('remove-bus-one', 'Bus One');
            const items =
                order === 'set-first'
                    ? [set, { ...remove, dependsOn: ['set-bus-one'] }]
                    : [remove, { ...set, dependsOn: ['remove-bus-one'] }];
            expect(compile(items, ['bus-one', 'track-kick'])).toEqual({
                status: 'rejected',
                reason: 'Structured command list contains contradictory mutation resources.',
            });
        }
    });

    it('rejects remove and rename aliases of the same section while composing distinct sections', () => {
        const compile = (items: readonly Record<string, unknown>[]) =>
            compileArbitraryCommandList({
                context,
                revision: 'revision-section-resources',
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: { plan: plan([]), list: { schemaVersion: 1, items } },
                    },
                ],
            });
        const renameVerse = {
            id: 'rename-verse',
            name: 'renameSection',
            arguments: { startBeat: 0, endBeat: 16, name: 'Verse', newName: 'Verse A' },
        };

        expect(
            compile([
                renameVerse,
                {
                    id: 'remove-verse',
                    name: 'removeSection',
                    arguments: { startBeat: 0, endBeat: 16, name: 'Verse' },
                    dependsOn: ['rename-verse'],
                },
            ])
        ).toEqual({
            status: 'rejected',
            reason: 'Structured command list contains contradictory mutation resources.',
        });
        expect(
            compile([
                renameVerse,
                {
                    id: 'remove-chorus',
                    name: 'removeSection',
                    arguments: { startBeat: 16, endBeat: 32, name: 'Chorus' },
                    dependsOn: ['rename-verse'],
                },
            ])
        ).toMatchObject({ status: 'accepted' });
    });

    it('composes compatible property writes in one registry-owned target resource family', () => {
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
                                { id: 'rename-kick', name: 'renameTrack', arguments: { name: 'Kick In' }, selector },
                                {
                                    id: 'mute-kick',
                                    name: 'muteTrack',
                                    arguments: { muted: true },
                                    selector,
                                    dependsOn: ['rename-kick'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
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
                                {
                                    id: 'enable-metronome',
                                    name: 'setMetronomeEnabled',
                                    arguments: { enabled: true },
                                    dependsOn: ['mute-kick-again'],
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
            { name: 'setMetronomeEnabled', arguments: { enabled: true } },
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
            expect.objectContaining({ itemId: 'enable-metronome', commandStart: 1, commandCount: 1 }),
        ]);
        if (result.compilerEvidence === undefined) {
            return;
        }
        expect(
            validateArbitraryCommandListEvidence({
                evidence: result.compilerEvidence,
                calls: result.compilerEvidence.commands,
                context,
                revision: 'revision-1',
            })
        ).toMatchObject({
            status: 'accepted',
            actionCommandGraph: { dependenciesByActionIndex: [[], [0]] },
        });
    });

    it('retains an independent duplicate canonical prerequisite through partial acceptance', async () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-duplicate-closure',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan([]),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'enable-metronome-once',
                                    name: 'setMetronomeEnabled',
                                    arguments: { enabled: true },
                                },
                                {
                                    id: 'enable-metronome-again',
                                    name: 'setMetronomeEnabled',
                                    arguments: { enabled: true },
                                },
                                {
                                    id: 'set-master-gain',
                                    name: 'setMasterGain',
                                    arguments: { gain: 0.9 },
                                    dependsOn: ['enable-metronome-again'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        const bridged = bridgeGroundedLlmToolCalls({
            calls: result.compilerEvidence.commands,
            compilerEvidence: result.compilerEvidence,
            context,
            projectRevision: 'revision-duplicate-closure',
            prompt: 'Enable the metronome and set the master gain to 0.9.',
        });
        expect(bridged.rejections).toEqual([]);
        const guarded = materializeActionStateGuards(bridged.actions, context);
        expect(guarded.status).toBe('accepted');
        if (guarded.status !== 'accepted') {
            return;
        }
        registerHandlerMap({
            setMetronomeEnabled: {
                describe: () => ({ label: 'Enable metronome' }),
                execute: () => ({ status: 'written' }),
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            },
            setMasterGain: {
                describe: () => ({ label: 'Set master gain' }),
                execute: () => ({ status: 'written' }),
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            },
        });
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'revision-duplicate-closure',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        commandBatchPreviewPort.setProvider(() => ({
            getProjectDocument: () => ({}),
            release: () => undefined,
            scope: (callback) => callback(),
        }));
        const compiled = compilePlannedActionCommandBatch({
            actions: guarded.actions,
            actionCommandGraph: bridged.actionCommandGraph,
            actionLabels: ['Enable metronome', 'Set master gain'],
            autoCommit: false,
            context,
            group: { groupId: 'group-duplicate-closure', groupLabel: 'Update master' },
            intent: 'Enable the metronome and set the master gain to 0.9.',
            mode: 'preview',
            projectRevision: 'revision-duplicate-closure',
            runId: 'run-duplicate-closure',
        });
        const parsed = parseVersionedCommandBatchEnvelope(compiled.commandBatch.serialized);
        expect(parsed.status).toBe('valid');
        if (parsed.status !== 'valid') {
            return;
        }
        const preview = await executeVersionedCommandBatchEnvelope({
            authority: compiled.commandBatch.authority,
            serialized: compiled.commandBatch.serialized,
        });
        expect(preview.status).toBe('previewed');
        if (preview.status !== 'previewed') {
            return;
        }
        const dependentId = parsed.envelope.commands[1]!.commandId;
        const partial = compilePartialCommandBatchAcceptance({
            batchId: 'group-duplicate-partial',
            previewSelection: preview.partialAcceptance,
            runId: 'run-duplicate-partial',
            selectedIntentGroupIds: [dependentId],
        });

        expect(partial).toMatchObject({
            status: 'compiled',
            includedOriginalCommandIds: parsed.envelope.commands.map((command) => command.commandId),
        });
        preview.resource.release();
    });

    it('expands a partially deduplicated selector item to every canonical representative', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-partial-dedup',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'track-hat']),
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
                                {
                                    id: 'mute-all-drums',
                                    name: 'muteTrack',
                                    arguments: { muted: true },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { kind: 'audio' },
                                        quantity: { unit: 'targets', exactly: 2 },
                                    },
                                },
                                {
                                    id: 'enable-metronome',
                                    name: 'setMetronomeEnabled',
                                    arguments: { enabled: true },
                                    dependsOn: ['mute-all-drums'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        expect(result.compilerEvidence.items[1]).toMatchObject({
            commandCount: 1,
            omittedCommandCount: 1,
            representativeCommandIndexes: [0, 1],
        });
        expect(
            validateArbitraryCommandListEvidence({
                evidence: result.compilerEvidence,
                calls: result.compilerEvidence.commands,
                context,
                revision: 'revision-partial-dedup',
            })
        ).toMatchObject({
            status: 'accepted',
            actionCommandGraph: { dependenciesByActionIndex: [[], [], [0, 1]] },
        });

        const tamperedEvidence = structuredClone(result.compilerEvidence);
        const partiallyDeduplicatedItem = tamperedEvidence.items[1]!;
        partiallyDeduplicatedItem.declaredCommandCount = 1;
        partiallyDeduplicatedItem.omittedCommandCount = 0;
        partiallyDeduplicatedItem.declaredCommandIdentities = [partiallyDeduplicatedItem.declaredCommandIdentities[1]!];
        partiallyDeduplicatedItem.representativeCommandIndexes = [
            partiallyDeduplicatedItem.representativeCommandIndexes[1]!,
        ];
        expect(
            validateArbitraryCommandListEvidence({
                evidence: tamperedEvidence,
                calls: tamperedEvidence.commands,
                context,
                revision: 'revision-partial-dedup',
            })
        ).toMatchObject({ status: 'rejected', reason: expect.stringContaining('representative coverage') });
    });

    it.each(['shared-vocal-fx-buses', 'drum-render-comparison', 'backing-vocal-plate'] as const)(
        'fails closed before a compiler graph can enter the application-expanded %s workflow',
        (workflowCapabilityId) => {
            const result = compileArbitraryCommandList({
                context,
                revision: 'revision-specialized-workflow',
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan: plan([]),
                            list: {
                                schemaVersion: 1,
                                items: [
                                    {
                                        id: 'enable-metronome',
                                        name: 'setMetronomeEnabled',
                                        arguments: { enabled: true },
                                    },
                                ],
                            },
                        },
                    },
                ],
            });

            expect(result).toMatchObject({ status: 'accepted' });
            if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
                return;
            }
            expect(
                bridgeGroundedLlmToolCalls({
                    calls: result.compilerEvidence.commands,
                    compilerEvidence: result.compilerEvidence,
                    context,
                    projectRevision: 'revision-specialized-workflow',
                    prompt: 'Enable the metronome.',
                    workflowCapabilityId,
                })
            ).toEqual({
                actions: [],
                rejections: [
                    {
                        index: 0,
                        name: '<batch>',
                        reason: 'Compiler command graphs cannot enter application-expanded specialized workflows',
                    },
                ],
            });
        }
    );

    it.each([
        { name: 'muteClip', valueArgument: 'muted', value: true },
        { name: 'lockClip', valueArgument: 'locked', value: true },
    ] as const)('canonicalizes duplicate and repeated $name set-to-value writes', ({ name, valueArgument, value }) => {
        const clipContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-kick'
                    ? {
                          ...track,
                          clipCount: 1,
                          clips: [
                              {
                                  id: 'clip-kick',
                                  name: 'Kick Clip',
                                  type: 'audio' as const,
                                  startBeat: 0,
                                  endBeat: 8,
                                  noteCount: 0,
                                  muted: false,
                                  locked: false,
                              },
                          ],
                      }
                    : track
            ),
        };
        const selector = {
            targetArgument: 'clipId',
            entity: 'clip',
            where: { name: 'Kick Clip' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const arguments_ = { [valueArgument]: value };
        const result = compileArbitraryCommandList({
            context: clipContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['clip-kick']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                { id: 'set-clip-state', name, arguments: arguments_, selector, repeat: { count: 2 } },
                                {
                                    id: 'set-clip-state-again',
                                    name,
                                    arguments: arguments_,
                                    selector,
                                    dependsOn: ['set-clip-state'],
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
            { name, arguments: { ...arguments_, clipId: 'clip-kick' } },
        ]);
        expect(result.compilerEvidence?.items).toEqual([
            expect.objectContaining({ itemId: 'set-clip-state', declaredCommandCount: 2, omittedCommandCount: 1 }),
            expect.objectContaining({
                itemId: 'set-clip-state-again',
                declaredCommandCount: 1,
                omittedCommandCount: 1,
            }),
        ]);
    });

    it('canonicalizes idempotent parameter writes with reversed argument key order', () => {
        const deviceContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-kick'
                    ? {
                          ...track,
                          deviceCount: 1,
                          devices: [
                              {
                                  id: 'device-kick-compressor',
                                  name: 'Kick Compressor',
                                  type: 'builtin-compressor',
                                  bypassed: false,
                                  parameters: [deviceParameter('threshold')],
                              },
                          ],
                      }
                    : track
            ),
        };
        const selector = {
            targetArgument: 'deviceId',
            entity: 'device',
            where: { name: 'Kick Compressor' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: deviceContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['device-kick-compressor', 'threshold']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'set-threshold',
                                    name: 'setDeviceParameter',
                                    arguments: { paramId: 'threshold', value: -18 },
                                    selector,
                                },
                                {
                                    id: 'set-threshold-again',
                                    name: 'setDeviceParameter',
                                    arguments: { value: -18, paramId: 'threshold' },
                                    selector,
                                    dependsOn: ['set-threshold'],
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
            {
                name: 'setDeviceParameter',
                arguments: { deviceId: 'device-kick-compressor', paramId: 'threshold', value: -18 },
            },
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

    it('composes writes to distinct parameters on the same selected device in order', () => {
        const deviceContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-kick'
                    ? {
                          ...track,
                          deviceCount: 1,
                          devices: [
                              {
                                  id: 'device-kick-compressor',
                                  name: 'Kick Compressor',
                                  type: 'builtin-compressor',
                                  bypassed: false,
                                  parameters: [deviceParameter('threshold'), deviceParameter('ratio')],
                              },
                          ],
                      }
                    : track
            ),
        };
        const selector = {
            targetArgument: 'deviceId',
            entity: 'device',
            where: { name: 'Kick Compressor' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: deviceContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['device-kick-compressor', 'threshold', 'ratio']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'set-threshold',
                                    name: 'setDeviceParameter',
                                    arguments: { paramId: 'threshold', value: -18 },
                                    selector,
                                },
                                {
                                    id: 'set-ratio',
                                    name: 'setDeviceParameter',
                                    arguments: { paramId: 'ratio', value: 4 },
                                    selector,
                                    dependsOn: ['set-threshold'],
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
            {
                name: 'setDeviceParameter',
                arguments: { deviceId: 'device-kick-compressor', paramId: 'threshold', value: -18 },
            },
            {
                name: 'setDeviceParameter',
                arguments: { deviceId: 'device-kick-compressor', paramId: 'ratio', value: 4 },
            },
        ]);
    });

    it('composes the same parameter write across distinct selected devices', () => {
        const deviceContext = {
            ...context,
            tracks: context.tracks.map((track) => ({
                ...track,
                deviceCount: 1,
                devices: [
                    {
                        id: `${track.id}-compressor`,
                        name: `${track.name} Compressor`,
                        type: 'builtin-compressor',
                        bypassed: false,
                        parameters: [deviceParameter('threshold')],
                    },
                ],
            })),
        };
        const result = compileArbitraryCommandList({
            context: deviceContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick-compressor', 'track-hat-compressor', 'threshold']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'set-threshold',
                                    name: 'setDeviceParameter',
                                    arguments: { paramId: 'threshold', value: -18 },
                                    selector: {
                                        targetArgument: 'deviceId',
                                        entity: 'device',
                                        where: { type: 'builtin-compressor' },
                                        quantity: { unit: 'targets', exactly: 2 },
                                    },
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
            {
                name: 'setDeviceParameter',
                arguments: { deviceId: 'track-kick-compressor', paramId: 'threshold', value: -18 },
            },
            {
                name: 'setDeviceParameter',
                arguments: { deviceId: 'track-hat-compressor', paramId: 'threshold', value: -18 },
            },
        ]);
    });

    it('derives composition identity from every catalog target argument', () => {
        const outputContext = {
            ...context,
            tracks: [
                ...context.tracks,
                {
                    ...context.tracks[0]!,
                    id: 'track-mix-bus',
                    name: 'Mix Bus',
                    kind: 'bus' as const,
                },
            ],
        };
        const selector = {
            targetArgument: 'outputId',
            entity: 'track',
            where: { name: 'Mix Bus' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: outputContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-mix-bus', 'track-kick', 'track-hat']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'route-kick',
                                    name: 'setTrackOutput',
                                    arguments: { trackId: 'track-kick' },
                                    selector,
                                },
                                {
                                    id: 'route-hat',
                                    name: 'setTrackOutput',
                                    arguments: { trackId: 'track-hat' },
                                    selector,
                                    dependsOn: ['route-kick'],
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
            { name: 'setTrackOutput', arguments: { outputId: 'track-mix-bus', trackId: 'track-kick' } },
            { name: 'setTrackOutput', arguments: { outputId: 'track-mix-bus', trackId: 'track-hat' } },
        ]);
    });

    it('rejects inverse routing writes from the same source to different destinations', () => {
        const outputContext = {
            ...context,
            tracks: [
                ...context.tracks,
                {
                    ...context.tracks[0]!,
                    id: 'track-mix-bus',
                    name: 'Mix Bus',
                    kind: 'bus' as const,
                },
                {
                    ...context.tracks[0]!,
                    id: 'track-print-bus',
                    name: 'Print Bus',
                    kind: 'bus' as const,
                },
            ],
        };
        const selector = {
            targetArgument: 'trackId',
            entity: 'track',
            where: { name: 'Kick' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: outputContext,
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
                                    id: 'route-kick-to-mix',
                                    name: 'setTrackOutput',
                                    arguments: { outputId: 'track-mix-bus' },
                                    selector,
                                },
                                {
                                    id: 'route-kick-to-print',
                                    name: 'setTrackOutput',
                                    arguments: { outputId: 'track-print-bus' },
                                    selector,
                                    dependsOn: ['route-kick-to-mix'],
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

    it('rejects moving the same clip to different destination tracks', () => {
        const clipContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-kick'
                    ? {
                          ...track,
                          clipCount: 1,
                          clips: [
                              {
                                  id: 'clip-kick',
                                  name: 'Kick Clip',
                                  type: 'audio' as const,
                                  startBeat: 0,
                                  endBeat: 4,
                                  noteCount: 0,
                              },
                          ],
                      }
                    : track
            ),
        };
        const selector = {
            targetArgument: 'clipId',
            entity: 'clip',
            where: { name: 'Kick Clip' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: clipContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['clip-kick']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'move-kick-to-kick',
                                    name: 'moveClip',
                                    arguments: { trackId: 'track-kick', startBeat: 4 },
                                    selector,
                                },
                                {
                                    id: 'move-kick-to-hat',
                                    name: 'moveClip',
                                    arguments: { trackId: 'track-hat', startBeat: 8 },
                                    selector,
                                    dependsOn: ['move-kick-to-kick'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for moveClip on clip-kick are not safely composable.',
        });
    });

    it('rejects duplicate non-idempotent mutations even when their arguments are identical', () => {
        const clipContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-kick'
                    ? {
                          ...track,
                          clipCount: 1,
                          clips: [
                              {
                                  id: 'clip-kick',
                                  name: 'Kick Clip',
                                  type: 'audio' as const,
                                  startBeat: 0,
                                  endBeat: 8,
                                  noteCount: 0,
                              },
                          ],
                      }
                    : track
            ),
        };
        const selector = {
            targetArgument: 'clipId',
            entity: 'clip',
            where: { name: 'Kick Clip' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: clipContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['clip-kick']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                { id: 'split-once', name: 'splitClip', arguments: { beat: 4 }, selector },
                                {
                                    id: 'split-again',
                                    name: 'splitClip',
                                    arguments: { beat: 4 },
                                    selector,
                                    dependsOn: ['split-once'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for splitClip on clip-kick are not safely composable.',
        });
    });

    it('composes moves of different clips to the same destination track', () => {
        const clipContext = {
            ...context,
            tracks: context.tracks.map((track) => ({
                ...track,
                clipCount: 1,
                clips: [
                    {
                        id: `clip-${track.id}`,
                        name: `${track.name} Clip`,
                        type: 'audio' as const,
                        startBeat: 0,
                        endBeat: 4,
                        noteCount: 0,
                    },
                ],
            })),
        };
        const result = compileArbitraryCommandList({
            context: clipContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['clip-track-kick', 'clip-track-hat', 'track-hat']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'move-kick',
                                    name: 'moveClip',
                                    arguments: { trackId: 'track-hat', startBeat: 4 },
                                    selector: {
                                        targetArgument: 'clipId',
                                        entity: 'clip',
                                        where: { name: 'Kick Clip' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                                {
                                    id: 'move-hat',
                                    name: 'moveClip',
                                    arguments: { trackId: 'track-hat', startBeat: 8 },
                                    selector: {
                                        targetArgument: 'clipId',
                                        entity: 'clip',
                                        where: { name: 'Hat Clip' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['move-kick'],
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
            { name: 'moveClip', arguments: { trackId: 'track-hat', startBeat: 4, clipId: 'clip-track-kick' } },
            { name: 'moveClip', arguments: { trackId: 'track-hat', startBeat: 8, clipId: 'clip-track-hat' } },
        ]);
    });

    it('rejects overlapping crossfade subjects even when a clip changes argument role', () => {
        const clipContext = {
            ...context,
            tracks: [
                {
                    ...context.tracks[0]!,
                    clipCount: 3,
                    clips: [
                        { id: 'clip-a', name: 'A', type: 'audio' as const, startBeat: 0, endBeat: 4, noteCount: 0 },
                        { id: 'clip-b', name: 'B', type: 'audio' as const, startBeat: 4, endBeat: 8, noteCount: 0 },
                        { id: 'clip-c', name: 'C', type: 'audio' as const, startBeat: 8, endBeat: 12, noteCount: 0 },
                    ],
                },
            ],
        };
        const result = compileArbitraryCommandList({
            context: clipContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['clip-a', 'clip-c']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'crossfade-a-b',
                                    name: 'crossfadeClips',
                                    arguments: { clipBId: 'clip-b', durationBeats: 0.5 },
                                    selector: {
                                        targetArgument: 'clipAId',
                                        entity: 'clip',
                                        where: { name: 'A' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                                {
                                    id: 'crossfade-c-a',
                                    name: 'crossfadeClips',
                                    arguments: { clipBId: 'clip-a', durationBeats: 0.5 },
                                    selector: {
                                        targetArgument: 'clipAId',
                                        entity: 'clip',
                                        where: { name: 'C' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['crossfade-a-b'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for crossfadeClips on clip-c are not safely composable.',
        });
    });

    it('rejects copying different articulation sources onto the same target clip', () => {
        const midiContext = {
            ...context,
            tracks: [
                {
                    ...context.tracks[0]!,
                    id: 'track-midi',
                    name: 'MIDI',
                    kind: 'midi',
                    clipCount: 3,
                    clips: [
                        {
                            id: 'clip-source-a',
                            name: 'Source A',
                            type: 'midi' as const,
                            startBeat: 0,
                            endBeat: 4,
                            noteCount: 1,
                        },
                        {
                            id: 'clip-source-b',
                            name: 'Source B',
                            type: 'midi' as const,
                            startBeat: 4,
                            endBeat: 8,
                            noteCount: 1,
                        },
                        {
                            id: 'clip-target',
                            name: 'Target',
                            type: 'midi' as const,
                            startBeat: 8,
                            endBeat: 12,
                            noteCount: 1,
                        },
                    ],
                },
            ],
        };
        const selector = {
            targetArgument: 'targetClipId',
            entity: 'clip',
            where: { name: 'Target' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: midiContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['clip-target']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'copy-source-a',
                                    name: 'copyMidiArticulations',
                                    arguments: { sourceClipId: 'clip-source-a' },
                                    selector,
                                },
                                {
                                    id: 'copy-source-b',
                                    name: 'copyMidiArticulations',
                                    arguments: { sourceClipId: 'clip-source-b' },
                                    selector,
                                    dependsOn: ['copy-source-a'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for copyMidiArticulations on clip-target are not safely composable.',
        });
    });

    it('rejects assigning the same track to different VCA destinations', () => {
        const selector = {
            targetArgument: 'trackId',
            entity: 'track',
            where: { name: 'Kick' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: {
                ...context,
                vcaGroups: [
                    { id: 'vca-a', name: 'VCA A', gain: 1, muted: false, trackIds: [] },
                    { id: 'vca-b', name: 'VCA B', gain: 1, muted: false, trackIds: [] },
                ],
            },
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'vca-a', 'vca-b']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'assign-kick-to-a',
                                    name: 'assignToVca',
                                    arguments: { vcaGroupId: 'vca-a' },
                                    selector,
                                },
                                {
                                    id: 'assign-kick-to-b',
                                    name: 'assignToVca',
                                    arguments: { vcaGroupId: 'vca-b' },
                                    selector,
                                    dependsOn: ['assign-kick-to-a'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for assignToVca on track-kick are not safely composable.',
        });
    });

    it('composes independent device child creation under one track', () => {
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
                                {
                                    id: 'insert-eq',
                                    name: 'addDevice',
                                    arguments: { deviceType: 'builtin-eq' },
                                    selector,
                                },
                                {
                                    id: 'insert-compressor',
                                    name: 'addDevice',
                                    arguments: { deviceType: 'builtin-compressor' },
                                    selector,
                                    dependsOn: ['insert-eq'],
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
            { name: 'addDevice', arguments: { deviceType: 'builtin-eq', trackId: 'track-kick' } },
            { name: 'addDevice', arguments: { deviceType: 'builtin-compressor', trackId: 'track-kick' } },
        ]);
    });

    it('rejects contradictory writes to the same parameter on the same selected device', () => {
        const deviceContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-kick'
                    ? {
                          ...track,
                          deviceCount: 1,
                          devices: [
                              {
                                  id: 'device-kick-compressor',
                                  name: 'Kick Compressor',
                                  type: 'builtin-compressor',
                                  bypassed: false,
                                  parameters: [deviceParameter('threshold')],
                              },
                          ],
                      }
                    : track
            ),
        };
        const selector = {
            targetArgument: 'deviceId',
            entity: 'device',
            where: { name: 'Kick Compressor' },
            quantity: { unit: 'targets', exactly: 1 },
        };
        const result = compileArbitraryCommandList({
            context: deviceContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['device-kick-compressor', 'threshold']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'set-threshold-low',
                                    name: 'setDeviceParameter',
                                    arguments: { paramId: 'threshold', value: -18 },
                                    selector,
                                },
                                {
                                    id: 'set-threshold-high',
                                    name: 'setDeviceParameter',
                                    arguments: { paramId: 'threshold', value: -12 },
                                    selector,
                                    dependsOn: ['set-threshold-low'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for setDeviceParameter on device-kick-compressor are not safely composable.',
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
        [
            'an unknown dependency',
            [{ id: 'one', name: 'muteTrack', arguments: { muted: true }, dependsOn: ['missing'] }],
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

    it('stably topologically sorts out-of-order acyclic items and expands one-to-many dependencies', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-topology',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'track-hat']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'enable-metronome',
                                    name: 'setMetronomeEnabled',
                                    arguments: { enabled: true },
                                    dependsOn: ['mute-drums'],
                                },
                                {
                                    id: 'independent-master-gain',
                                    name: 'setMasterGain',
                                    arguments: { gain: 0.9 },
                                },
                                {
                                    id: 'mute-drums',
                                    name: 'muteTrack',
                                    arguments: { muted: true },
                                    selector: {
                                        targetArgument: 'trackId',
                                        entity: 'track',
                                        where: { kind: 'audio' },
                                        quantity: { unit: 'targets', exactly: 2 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        expect(result.compilerEvidence.commands.map((command) => command.name)).toEqual([
            'setMasterGain',
            'muteTrack',
            'muteTrack',
            'setMetronomeEnabled',
        ]);
        expect(result.compilerEvidence.items.map((item) => item.itemId)).toEqual([
            'independent-master-gain',
            'mute-drums',
            'enable-metronome',
        ]);
        const validation = validateArbitraryCommandListEvidence({
            evidence: result.compilerEvidence,
            calls: result.compilerEvidence.commands,
            context,
            revision: 'revision-topology',
        });
        expect(validation).toMatchObject({
            status: 'accepted',
            actionCommandGraph: {
                dependenciesByActionIndex: [[], [], [], [1, 2]],
                batchLocalBindings: [],
            },
        });
    });

    it.each(['remove-first', 'route-first'] as const)(
        'rejects a removed bus referenced by a direct routing target when %s',
        (order) => {
            const routingContext = {
                ...context,
                tracks: [
                    ...context.tracks.map((track) => ({ ...track, outputId: 'master' })),
                    {
                        ...context.tracks[0]!,
                        id: 'track-drum-bus',
                        name: 'Drum Bus',
                        kind: 'bus',
                        outputId: 'master',
                    },
                ],
            };
            const remove = {
                id: 'remove-drum-bus',
                name: 'removeTrack',
                arguments: {},
                selector: {
                    targetArgument: 'trackId',
                    entity: 'track',
                    where: { name: 'Drum Bus' },
                    quantity: { unit: 'targets', exactly: 1 },
                },
            };
            const route = {
                id: 'route-kick',
                name: 'setTrackOutput',
                arguments: { outputId: 'track-drum-bus' },
                selector: {
                    targetArgument: 'trackId',
                    entity: 'track',
                    where: { name: 'Kick' },
                    quantity: { unit: 'targets', exactly: 1 },
                },
            };
            const items =
                order === 'remove-first'
                    ? [remove, { ...route, dependsOn: ['remove-drum-bus'] }]
                    : [route, { ...remove, dependsOn: ['route-kick'] }];

            expect(
                compileArbitraryCommandList({
                    context: routingContext,
                    revision: 'revision-contradiction',
                    calls: [
                        {
                            name: 'command.batch.propose',
                            arguments: {
                                plan: plan(['track-kick', 'track-drum-bus']),
                                list: { schemaVersion: 1, items },
                            },
                        },
                    ],
                })
            ).toEqual({
                status: 'rejected',
                reason: 'Structured command list contains contradictory mutation resources.',
            });
        }
    );

    it.each([
        { childName: 'addClip', childArguments: { startBeat: 0, endBeat: 4, name: 'Verse' } },
        { childName: 'addDevice', childArguments: { deviceType: 'builtin-eq' } },
    ] as const)('rejects $childName and removeTrack on the same parent track in either order', (child) => {
        const selector = {
            targetArgument: 'trackId',
            entity: 'track' as const,
            where: { name: 'Kick' },
            quantity: { unit: 'targets' as const, exactly: 1 },
        };
        const childItem = {
            id: 'add-child',
            name: child.childName,
            arguments: child.childArguments,
            selector,
        };
        const removeItem = { id: 'remove-parent', name: 'removeTrack', arguments: {}, selector };

        for (const items of [
            [childItem, { ...removeItem, dependsOn: ['add-child'] }],
            [removeItem, { ...childItem, dependsOn: ['remove-parent'] }],
        ]) {
            expect(
                compileArbitraryCommandList({
                    context,
                    revision: 'revision-parent-track',
                    calls: [
                        {
                            name: 'command.batch.propose',
                            arguments: {
                                plan: plan(['track-kick']),
                                list: { schemaVersion: 1, items },
                            },
                        },
                    ],
                })
            ).toEqual({
                status: 'rejected',
                reason: 'Structured command list contains contradictory mutation resources.',
            });
        }
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

    it.each([
        {
            name: 'armTrack',
            targetArgument: 'trackId',
            arguments_: { armed: true },
            scopeIds: ['target'],
            ineligibleKind: 'vca',
            eligibleKind: 'audio',
        },
        {
            name: 'addDevice',
            targetArgument: 'trackId',
            arguments_: { deviceType: 'builtin-eq' },
            scopeIds: ['target'],
            ineligibleKind: 'vca',
            eligibleKind: 'audio',
        },
        {
            name: 'setTrackOutput',
            targetArgument: 'outputId',
            arguments_: { trackId: 'track-source' },
            scopeIds: ['target', 'track-source'],
            ineligibleKind: 'audio',
            eligibleKind: 'bus',
        },
        {
            name: 'addSend',
            targetArgument: 'busId',
            arguments_: { trackId: 'track-source', level: 0.5 },
            scopeIds: ['target', 'track-source'],
            ineligibleKind: 'audio',
            eligibleKind: 'bus',
        },
    ] as const)('rejects an ineligible $name selector while accepting its canonical capability kind', (entry) => {
        const compile = (kind: string) =>
            compileArbitraryCommandList({
                context: {
                    ...context,
                    tracks: [
                        { ...context.tracks[0]!, id: 'target', name: 'Target', kind },
                        { ...context.tracks[0]!, id: 'track-source', name: 'Source', kind: 'audio' },
                    ],
                },
                revision: 'revision-1',
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan: plan([...entry.scopeIds]),
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

    it('admits an earlier dependency-complete batch-local target without inventing a stable project ID', () => {
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
                                {
                                    id: 'create-drum-bus',
                                    name: 'createBus',
                                    arguments: { name: 'Drum Bus', binding: 'drum-bus' },
                                },
                                {
                                    id: 'gain-drum-bus',
                                    name: 'setTrackGain',
                                    arguments: { trackId: '$drum-bus', gain: 0.8 },
                                    dependsOn: ['create-drum-bus'],
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
            { name: 'createBus', arguments: { name: 'Drum Bus', binding: 'drum-bus' } },
            { name: 'setTrackGain', arguments: { trackId: '$drum-bus', gain: 0.8 } },
        ]);
    });

    it('carries transitive batch-local producers through serialized dependencies and partial acceptance', async () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-graph',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan([]),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'create-drum-bus',
                                    name: 'createBus',
                                    arguments: { name: 'Drum Bus', binding: 'drum-bus' },
                                },
                                {
                                    id: 'gain-drum-bus',
                                    name: 'setTrackGain',
                                    arguments: { trackId: '$drum-bus', gain: 0.8 },
                                    dependsOn: ['create-drum-bus'],
                                },
                                {
                                    id: 'pan-drum-bus',
                                    name: 'setTrackPan',
                                    arguments: { trackId: '$drum-bus', pan: -0.25 },
                                    dependsOn: ['gain-drum-bus'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        const bridged = bridgeGroundedLlmToolCalls({
            calls: result.compilerEvidence.commands,
            compilerEvidence: result.compilerEvidence,
            context,
            projectRevision: 'revision-graph',
            prompt: 'Create a Drum Bus, set its gain to 0.8, then pan it left.',
        });
        expect(bridged.rejections).toEqual([]);
        expect(bridged.actionCommandGraph?.dependenciesByActionIndex).toEqual([[], [0], [0, 1]]);
        const materialized = materializeBatchLocalActionIdentities(
            bridged.actions,
            bridged.batchLocalActionIdentities ?? []
        );
        expect(materialized.status).toBe('accepted');
        if (materialized.status !== 'accepted') {
            return;
        }
        const guarded = materializeActionStateGuards(materialized.actions, context);
        expect(guarded.status).toBe('accepted');
        if (guarded.status !== 'accepted') {
            return;
        }
        const busId = guarded.actions[0]?.type === 'createBus' ? guarded.actions[0].payload.busId : undefined;
        expect(busId).toBeDefined();
        if (busId === undefined) {
            return;
        }
        registerHandlerMap({
            createBus: {
                describe: () => ({ label: 'Create Drum Bus' }),
                execute: () => ({ status: 'written' }),
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            },
            setTrackGain: {
                describe: () => ({ label: 'Set Drum Bus gain' }),
                execute: () => ({ status: 'written' }),
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            },
            setTrackPan: {
                describe: () => ({ label: 'Pan Drum Bus left' }),
                execute: () => ({ status: 'written' }),
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            },
        });
        commandTrackDefaultsPort.setTrackColorProvider(() => '#123456');
        commandBatchPreflightPort.setProvider(({ projectDocument }) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'revision-graph',
            projectInvariantsValid: true,
            targetFingerprints: projectDocument === undefined ? {} : { [busId]: 'created-drum-bus' },
        }));
        commandBatchPreviewPort.setProvider(() => ({
            getProjectDocument: () => ({}),
            release: () => undefined,
            scope: (callback) => callback(),
        }));
        const compileInput = {
            actions: guarded.actions,
            actionLabels: ['Create Drum Bus', 'Set Drum Bus gain', 'Pan Drum Bus left'],
            actionCommandGraph: bridged.actionCommandGraph,
            autoCommit: false,
            context,
            group: { groupId: 'group-graph', groupLabel: 'Create Drum Bus' },
            intent: 'Create a Drum Bus, set its gain to 0.8, then pan it left.',
            mode: 'preview' as const,
            projectRevision: 'revision-graph',
            runId: 'run-graph',
        };
        const compiled = compilePlannedActionCommandBatch(compileInput);
        const parsed = parseVersionedCommandBatchEnvelope(compiled.commandBatch.serialized);
        expect(parsed.status).toBe('valid');
        if (parsed.status !== 'valid') {
            return;
        }
        const [producer, gain, pan] = parsed.envelope.commands;
        expect(gain?.dependencyIds).toEqual([producer?.commandId]);
        expect(pan?.dependencyIds).toEqual([producer?.commandId, gain?.commandId]);
        expect(parsed.envelope.dependencies).toEqual([
            { commandId: gain?.commandId, dependsOn: [producer?.commandId] },
            { commandId: pan?.commandId, dependsOn: [producer?.commandId, gain?.commandId] },
        ]);
        expect(parsed.envelope.batchLocalBindings).toEqual([
            {
                bindingId: '$drum-bus',
                producerArgument: 'busId',
                producerCommandId: producer?.commandId,
            },
        ]);
        const preview = await executeVersionedCommandBatchEnvelope({
            authority: compiled.commandBatch.authority,
            serialized: compiled.commandBatch.serialized,
        });
        expect(preview.status).toBe('previewed');
        if (preview.status !== 'previewed' || pan === undefined) {
            return;
        }
        const partial = compilePartialCommandBatchAcceptance({
            batchId: 'group-graph-partial',
            previewSelection: preview.partialAcceptance,
            runId: 'run-graph-partial',
            selectedIntentGroupIds: [pan.commandId],
        });
        expect(partial).toMatchObject({
            status: 'compiled',
            includedOriginalCommandIds: parsed.envelope.commands.map((command) => command.commandId),
        });
        preview.resource.release();
        expect(compiled.commandBatch.authority.scope.targetIds).toEqual([busId]);
        expect(
            planAgentRun({
                request: 'Create a Drum Bus, set its gain to 0.8, then pan it left.',
                revision: 'revision-graph',
                actions: guarded.actions,
                actionLabels: ['Create Drum Bus', 'Set Drum Bus gain', 'Pan Drum Bus left'],
                scope: {
                    ...compiled.commandBatch.authority.scope,
                    targetIds: [...compiled.commandBatch.authority.scope.targetIds],
                    targetRanges: [...compiled.commandBatch.authority.scope.targetRanges],
                    protectedTargetIds: [...compiled.commandBatch.authority.scope.protectedTargetIds],
                    protectedRanges: [...compiled.commandBatch.authority.scope.protectedRanges],
                },
                grants: {
                    ...compiled.commandBatch.authority.grants,
                    allowedOperationPrefixes: [...compiled.commandBatch.authority.grants.allowedOperationPrefixes],
                },
                budgets: { limits: compiled.commandBatch.authority.budgets, consumed: {} },
                requiresConfirmation: true,
                providerProposal: {
                    ...plan([busId]),
                    semantic: { classification: 'simple' as const, uncertainty: [] },
                    objective: 'Create and gain a drum bus.',
                },
                requireProviderProposal: true,
            })
        ).toMatchObject({ status: 'planned' });
    });

    it('rejects contradictory selectorless writes to one validated batch-local target', () => {
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
                                {
                                    id: 'create-drum-bus',
                                    name: 'createBus',
                                    arguments: { name: 'Drum Bus', binding: 'drum-bus' },
                                },
                                {
                                    id: 'gain-drum-bus',
                                    name: 'setTrackGain',
                                    arguments: { trackId: '$drum-bus', gain: 0.8 },
                                    dependsOn: ['create-drum-bus'],
                                },
                                {
                                    id: 'regain-drum-bus',
                                    name: 'setTrackGain',
                                    arguments: { trackId: '$drum-bus', gain: 0.6 },
                                    dependsOn: ['gain-drum-bus'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for setTrackGain on $drum-bus are not safely composable.',
        });
    });

    it('deduplicates identical selectorless writes to one validated batch-local target', () => {
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
                                {
                                    id: 'create-drum-bus',
                                    name: 'createBus',
                                    arguments: { name: 'Drum Bus', binding: 'drum-bus' },
                                },
                                {
                                    id: 'gain-drum-bus',
                                    name: 'setTrackGain',
                                    arguments: { trackId: '$drum-bus', gain: 0.8 },
                                    dependsOn: ['create-drum-bus'],
                                },
                                {
                                    id: 'gain-drum-bus-again',
                                    name: 'setTrackGain',
                                    arguments: { gain: 0.8, trackId: '$drum-bus' },
                                    dependsOn: ['gain-drum-bus'],
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
            { name: 'createBus', arguments: { name: 'Drum Bus', binding: 'drum-bus' } },
            { name: 'setTrackGain', arguments: { trackId: '$drum-bus', gain: 0.8 } },
        ]);
    });

    it('combines one exact many-target selector with an earlier batch-local destination', () => {
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
                                    id: 'create-plate-bus',
                                    name: 'createBus',
                                    arguments: { name: 'Plate Bus', binding: 'plate-bus' },
                                },
                                {
                                    id: 'automate-plate-sends',
                                    name: 'automateSendRanges',
                                    arguments: {
                                        busId: '$plate-bus',
                                        sectionIds: ['section-chorus'],
                                        tailBars: 4,
                                        targetLevelDb: -12,
                                    },
                                    selector: {
                                        targetArgument: 'trackIds',
                                        entity: 'track',
                                        where: { kind: 'audio' },
                                        quantity: { unit: 'targets', exactly: 2 },
                                    },
                                    dependsOn: ['create-plate-bus'],
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
            { name: 'createBus', arguments: { name: 'Plate Bus', binding: 'plate-bus' } },
            {
                name: 'automateSendRanges',
                arguments: {
                    busId: '$plate-bus',
                    sectionIds: ['section-chorus'],
                    tailBars: 4,
                    targetLevelDb: -12,
                    trackIds: ['track-kick', 'track-hat'],
                },
            },
        ]);
    });

    it.each([
        {
            label: 'a direct stable target without a selector',
            items: [{ id: 'gain-kick', name: 'setTrackGain', arguments: { trackId: 'track-kick', gain: 0.8 } }],
        },
        {
            label: 'a batch-local target without its producer dependency',
            items: [
                {
                    id: 'create-drum-bus',
                    name: 'createBus',
                    arguments: { name: 'Drum Bus', binding: 'drum-bus' },
                },
                {
                    id: 'gain-drum-bus',
                    name: 'setTrackGain',
                    arguments: { trackId: '$drum-bus', gain: 0.8 },
                },
            ],
        },
        {
            label: 'an unknown batch-local target',
            items: [
                {
                    id: 'gain-drum-bus',
                    name: 'setTrackGain',
                    arguments: { trackId: '$missing-bus', gain: 0.8 },
                },
            ],
        },
        {
            label: 'a batch-local target forbidden by command metadata',
            items: [
                {
                    id: 'create-drum-bus',
                    name: 'createBus',
                    arguments: { name: 'Drum Bus', binding: 'drum-bus' },
                },
                {
                    id: 'solo-safe-drum-bus',
                    name: 'setSoloSafe',
                    arguments: { trackId: '$drum-bus', soloSafe: true },
                    dependsOn: ['create-drum-bus'],
                },
            ],
        },
    ])('rejects $label', ({ items }) => {
        expect(
            compileArbitraryCommandList({
                context,
                revision: 'revision-1',
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: { plan: plan([]), list: { schemaVersion: 1, items } },
                    },
                ],
            })
        ).toMatchObject({ status: 'rejected' });
    });

    it('compiles an exact ordered many-target selector into one bounded array argument', () => {
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
                                    id: 'lift-drums',
                                    name: 'automateTrackGainRange',
                                    arguments: { sectionName: 'Chorus', gainDb: 1.5 },
                                    selector: {
                                        targetArgument: 'trackIds',
                                        entity: 'track',
                                        where: { kind: 'audio' },
                                        quantity: { unit: 'targets', exactly: 2 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        expect(result.calls[0]?.arguments.commands).toEqual([
            {
                name: 'automateTrackGainRange',
                arguments: { sectionName: 'Chorus', gainDb: 1.5, trackIds: ['track-kick', 'track-hat'] },
            },
        ]);
        const validation = validateArbitraryCommandListEvidence({
            evidence: result.compilerEvidence,
            calls: result.compilerEvidence.commands,
            context,
            revision: 'revision-1',
        });
        expect(validation).toMatchObject({ status: 'accepted' });
        if (validation.status === 'accepted') {
            expect(validation.targetOverridesByCallIndex.get(0)).toEqual([
                {
                    argument: 'trackIds',
                    capability: 'routable-source',
                    cardinality: 'many',
                    stableIds: ['track-kick', 'track-hat'],
                },
            ]);
        }
    });

    it('rejects different many-target writes when their expanded mutation identities partially overlap', () => {
        const overlapContext = {
            ...context,
            tracks: [
                ...context.tracks,
                {
                    ...context.tracks[0]!,
                    id: 'track-ride',
                    name: 'Ride',
                },
            ],
        };
        const result = compileArbitraryCommandList({
            context: overlapContext,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'track-hat', 'track-ride']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'lift-kick-and-hat',
                                    name: 'automateTrackGainRange',
                                    arguments: { sectionName: 'Chorus', gainDb: 1.5 },
                                    selector: {
                                        targetArgument: 'trackIds',
                                        entity: 'track',
                                        where: { kind: 'audio' },
                                        excludeIds: ['track-ride'],
                                        quantity: { unit: 'targets', exactly: 2 },
                                    },
                                },
                                {
                                    id: 'lift-hat-and-ride',
                                    name: 'automateTrackGainRange',
                                    arguments: { sectionName: 'Chorus', gainDb: 2 },
                                    selector: {
                                        targetArgument: 'trackIds',
                                        entity: 'track',
                                        where: { kind: 'audio' },
                                        excludeIds: ['track-kick'],
                                        quantity: { unit: 'targets', exactly: 2 },
                                    },
                                    dependsOn: ['lift-kick-and-hat'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for automateTrackGainRange on track-hat,track-ride are not safely composable.',
        });
    });

    it('excludes protected targets from a many-target array and revalidates the exact evidence', () => {
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
                                    id: 'lift-unprotected-drums',
                                    name: 'automateTrackGainRange',
                                    arguments: { sectionName: 'Chorus', gainDb: 1.5 },
                                    selector: {
                                        targetArgument: 'trackIds',
                                        entity: 'track',
                                        where: { kind: 'audio' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        expect(result.compilerEvidence.commands[0]?.arguments.trackIds).toEqual(['track-hat']);
        expect(result.compilerEvidence.selectors[0]?.protectedExclusions).toEqual(['track-kick']);
        expect(
            validateArbitraryCommandListEvidence({
                evidence: result.compilerEvidence,
                calls: result.compilerEvidence.commands,
                context: {
                    ...context,
                    tracks: context.tracks.map((track) =>
                        track.id === 'track-hat' ? { ...track, name: 'Changed after planning' } : track
                    ),
                },
                revision: 'revision-1',
            })
        ).toMatchObject({ status: 'rejected' });
    });

    it('rejects many-target direct IDs and selector enlargement', () => {
        const direct = compileArbitraryCommandList({
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
                                {
                                    id: 'direct-lift',
                                    name: 'automateTrackGainRange',
                                    arguments: {
                                        trackIds: ['track-kick', 'track-hat'],
                                        sectionName: 'Chorus',
                                        gainDb: 1.5,
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });
        const enlarged = compileArbitraryCommandList({
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
                                    id: 'enlarged-lift',
                                    name: 'automateTrackGainRange',
                                    arguments: { sectionName: 'Chorus', gainDb: 1.5 },
                                    selector: {
                                        targetArgument: 'trackIds',
                                        entity: 'track',
                                        where: { kind: 'audio' },
                                        quantity: { unit: 'targets', exactly: 2 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(direct).toMatchObject({ status: 'rejected' });
        expect(enlarged).toMatchObject({ status: 'rejected' });
    });

    it('resolves adjustment-layer selectors only from the supplied project context', () => {
        const adjustmentLayer = {
            id: 'layer-bass-air',
            name: 'Bass Air',
            effectType: 'eq' as const,
            parameters: [],
            affectedTrackIds: ['track-kick'],
            insertionIndex: 0,
            regions: [],
            enabled: true,
            mix: 1,
            color: '#ffffff',
        };
        const result = compileArbitraryCommandList({
            context: { ...context, adjustmentLayers: [adjustmentLayer] },
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['layer-bass-air']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'add-bass-air-region',
                                    name: 'addAdjustmentRegion',
                                    arguments: {
                                        startBeat: 16,
                                        endBeat: 32,
                                        blend: 1,
                                        fadeInBeats: 0,
                                        fadeOutBeats: 0,
                                    },
                                    selector: {
                                        targetArgument: 'layerId',
                                        entity: 'adjustment-layer',
                                        where: { name: 'Bass Air' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
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
            {
                name: 'addAdjustmentRegion',
                arguments: {
                    startBeat: 16,
                    endBeat: 32,
                    blend: 1,
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    layerId: 'layer-bass-air',
                },
            },
        ]);
    });

    it('rejects unsupported nested semantic-list fields', () => {
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
                                        where: { name: 'Kick', providerAuthority: 'all-tracks' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'rejected' });
    });
});
