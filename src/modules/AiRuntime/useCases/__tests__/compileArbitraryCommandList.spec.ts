import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';

import { SEMANTIC_COMMAND_LIST_MAX_CREATIONS } from '../../models/SemanticCommandList';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { materializeBatchLocalActionIdentities } from '../agentReference/materializeBatchLocalActionIdentities';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { planAgentRun } from '../planAgentRun';
import { validateArbitraryCommandListEvidence } from '../validateArbitraryCommandListEvidence';

import type { ProjectContext } from '../../models/ProjectContext';

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

const duplicateClipContext = {
    ...context,
    tracks: context.tracks.map((track) =>
        track.id === 'track-kick'
            ? {
                  ...track,
                  clipCount: 1,
                  clips: [
                      {
                          id: 'clip-kick-a',
                          name: 'Kick A',
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

const emptyMidiClipContext = {
    ...context,
    tracks: [
        {
            ...context.tracks[0]!,
            id: 'track-midi',
            name: 'MIDI',
            kind: 'midi' as const,
            clipCount: 1,
            clips: [
                {
                    id: 'clip-empty-midi',
                    name: 'Empty MIDI',
                    type: 'midi' as const,
                    startBeat: 0,
                    endBeat: 4,
                    noteCount: 0,
                },
            ],
        },
        context.tracks[1]!,
    ],
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

const supportedSidechainDevice = {
    id: 'device-bass-compressor',
    name: 'Bass Compressor',
    type: 'builtin-sidechain-compressor',
    bypassed: false,
};

function compileSidechainDeviceSelector(input: {
    devices?: Array<typeof supportedSidechainDevice>;
    arguments_?: { targetDeviceId?: string };
    protectedTargetIds?: string[];
}) {
    const devices = input.devices ?? [supportedSidechainDevice];
    const selectedDevice = devices[0]!;
    return compileArbitraryCommandList({
        context: {
            ...context,
            tracks: [
                context.tracks[0]!,
                {
                    ...context.tracks[1]!,
                    id: 'track-bass',
                    name: 'Bass',
                    devices,
                },
            ],
        },
        revision: 'revision-1',
        calls: [
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: plan(['track-kick', 'track-bass', selectedDevice.id], input.protectedTargetIds),
                    list: {
                        schemaVersion: 1,
                        items: [
                            {
                                id: 'sidechain-bass',
                                name: 'addSidechainRoute',
                                arguments: {
                                    sourceTrackId: 'track-kick',
                                    targetTrackId: 'track-bass',
                                    ...input.arguments_,
                                },
                                selector: {
                                    targetArgument: 'targetDeviceId',
                                    entity: 'device',
                                    where: {
                                        name: selectedDevice.name,
                                        trackId: 'track-bass',
                                        type: selectedDevice.type,
                                    },
                                    quantity: { unit: 'targets', exactly: 1 },
                                },
                            },
                        ],
                    },
                },
            },
        ],
    });
}

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
        vi.restoreAllMocks();
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandBatchPreviewPort.setProvider(null);
        commandTrackDefaultsPort.setTrackColorProvider(null);
    });

    it('rejects an expanded semantic list above the runtime execution budget', () => {
        const trackIds = Array.from({ length: 25 }, (_, index) => `track-budget-${String(index)}`);
        const budgetContext = {
            ...context,
            tracks: trackIds.map((id, index) => ({
                ...context.tracks[0]!,
                id,
                name: `Budget Track ${String(index)}`,
            })),
        };

        expect(
            compileArbitraryCommandList({
                context: budgetContext,
                revision: 'revision-command-budget',
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan: plan(trackIds),
                            list: {
                                schemaVersion: 1,
                                items: [
                                    {
                                        id: 'mute-all-budget-tracks',
                                        name: 'muteTrack',
                                        arguments: { muted: true },
                                        selector: {
                                            targetArgument: 'trackId',
                                            entity: 'track',
                                            where: { kind: 'audio' },
                                            quantity: { unit: 'targets', exactly: 25 },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Structured command list does not match the versioned application contract.',
        });
    });

    it.each([
        { family: 'device', order: 'parent-first' },
        { family: 'device', order: 'child-first' },
        { family: 'send', order: 'parent-first' },
        { family: 'send', order: 'child-first' },
        { family: 'automation-lane', order: 'parent-first' },
        { family: 'automation-lane', order: 'child-first' },
        { family: 'automated-track', order: 'parent-first' },
        { family: 'automated-track', order: 'child-first' },
        { family: 'automation-lane-creation', order: 'parent-first' },
        { family: 'automation-lane-creation', order: 'child-first' },
        { family: 'clip-single', order: 'parent-first' },
        { family: 'clip-single', order: 'child-first' },
        { family: 'clip-many', order: 'parent-first' },
        { family: 'clip-many', order: 'child-first' },
        { family: 'clip-dual', order: 'parent-first' },
        { family: 'clip-dual', order: 'child-first' },
        { family: 'clip-source-target', order: 'parent-first' },
        { family: 'clip-source-target', order: 'child-first' },
        { family: 'sidechain', order: 'parent-first' },
        { family: 'sidechain', order: 'child-first' },
    ] as const)('rejects removeTrack with a $family child mutation when $order', ({ family, order }) => {
        const conflictContext = {
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
            tracks: [
                ...context.tracks.map((track) =>
                    track.id === 'track-kick'
                        ? {
                              ...track,
                              sends: [{ busId: 'track-hat', level: 0.5, preFader: false }],
                              clipCount: 2,
                              clips: [
                                  {
                                      id: 'clip-kick-a',
                                      name: 'Kick A',
                                      type: 'midi' as const,
                                      startBeat: 0,
                                      endBeat: 4,
                                      noteCount: 1,
                                  },
                                  {
                                      id: 'clip-kick-b',
                                      name: 'Kick B',
                                      type: 'midi' as const,
                                      startBeat: 4,
                                      endBeat: 8,
                                      noteCount: 1,
                                  },
                              ],
                              deviceCount: 1,
                              devices: [
                                  {
                                      id: 'device-kick',
                                      name: 'Kick EQ',
                                      type: 'builtin-eq',
                                      bypassed: false,
                                      parameters: [deviceParameter('gain')],
                                  },
                              ],
                          }
                        : {
                              ...track,
                              clipCount: 1,
                              clips: [
                                  {
                                      id: 'clip-hat-target',
                                      name: 'Hat Target',
                                      type: 'midi' as const,
                                      startBeat: 0,
                                      endBeat: 4,
                                      noteCount: 1,
                                  },
                              ],
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
                ),
                { ...context.tracks[0]!, id: 'track-send-bus', name: 'Send Bus', kind: 'bus' as const },
            ],
        };
        const removeTrack = {
            id: 'remove-kick',
            name: 'removeTrack',
            arguments: {},
            selector: {
                targetArgument: 'trackId',
                entity: 'track' as const,
                where: { name: 'Kick' },
                quantity: { unit: 'targets' as const, exactly: 1 },
            },
        };
        const childByFamily = {
            device: {
                id: 'bypass-kick-device',
                name: 'bypassDevice',
                arguments: { bypassed: true },
                selector: {
                    targetArgument: 'deviceId',
                    entity: 'device' as const,
                    where: { name: 'Kick EQ' },
                    quantity: { unit: 'targets' as const, exactly: 1 },
                },
            },
            send: {
                id: 'adjust-kick-send',
                name: 'setSend',
                arguments: { trackId: 'track-kick', level: 0.25 },
                selector: {
                    targetArgument: 'busId',
                    entity: 'track' as const,
                    where: { name: 'Send Bus' },
                    quantity: { unit: 'targets' as const, exactly: 1 },
                },
            },
            'automation-lane': {
                id: 'disable-kick-lane',
                name: 'setAutomationLaneEnabled',
                arguments: { enabled: false },
                selector: {
                    targetArgument: 'laneId',
                    entity: 'automation-lane' as const,
                    where: { name: 'Kick Gain' },
                    quantity: { unit: 'targets' as const, exactly: 1 },
                },
            },
            'automated-track': {
                id: 'automate-kick-gain',
                name: 'automateTrackGainRange',
                arguments: { sectionName: 'Chorus', gainDb: 1.5 },
                selector: {
                    targetArgument: 'trackIds',
                    entity: 'track' as const,
                    where: { name: 'Kick' },
                    quantity: { unit: 'targets' as const, exactly: 1 },
                },
            },
            'automation-lane-creation': {
                id: 'create-kick-gain-lane',
                name: 'addAutomationLane',
                arguments: { parameterId: 'gain' },
                selector: {
                    targetArgument: 'trackId',
                    entity: 'track' as const,
                    where: { name: 'Kick' },
                    quantity: { unit: 'targets' as const, exactly: 1 },
                },
            },
            'clip-single': {
                id: 'gain-kick-a',
                name: 'setClipGain',
                arguments: { gain: 0.5 },
                selector: {
                    targetArgument: 'clipId',
                    entity: 'clip' as const,
                    where: { name: 'Kick A' },
                    quantity: { unit: 'targets' as const, exactly: 1 },
                },
            },
            'clip-many': {
                id: 'glue-kick-clips',
                name: 'glueClips',
                arguments: {},
                selector: {
                    targetArgument: 'clipIds',
                    entity: 'clip' as const,
                    where: { trackId: 'track-kick' },
                    quantity: { unit: 'targets' as const, exactly: 2 },
                },
            },
            'clip-dual': {
                id: 'crossfade-kick-clips',
                name: 'crossfadeClips',
                arguments: { clipBId: 'clip-kick-b', durationBeats: 0.5 },
                selector: {
                    targetArgument: 'clipAId',
                    entity: 'clip' as const,
                    where: { name: 'Kick A' },
                    quantity: { unit: 'targets' as const, exactly: 1 },
                },
            },
            'clip-source-target': {
                id: 'copy-kick-articulations',
                name: 'copyMidiArticulations',
                arguments: { sourceClipId: 'clip-kick-a' },
                selector: {
                    targetArgument: 'targetClipId',
                    entity: 'clip' as const,
                    where: { name: 'Hat Target' },
                    quantity: { unit: 'targets' as const, exactly: 1 },
                },
            },
            sidechain: {
                id: 'remove-kick-sidechain',
                name: 'removeSidechainRoute',
                arguments: { targetTrackId: 'track-hat' },
                selector: {
                    targetArgument: 'sourceTrackId',
                    entity: 'track' as const,
                    where: { name: 'Kick' },
                    quantity: { unit: 'targets' as const, exactly: 1 },
                },
            },
        } as const;
        const child = childByFamily[family];
        const targetIdsByFamily = {
            device: ['track-kick', 'device-kick'],
            send: ['track-kick', 'track-send-bus'],
            'automation-lane': ['track-kick', 'lane-kick-gain'],
            'automated-track': ['track-kick'],
            'automation-lane-creation': ['track-kick'],
            'clip-single': ['track-kick', 'clip-kick-a'],
            'clip-many': ['track-kick', 'clip-kick-a', 'clip-kick-b'],
            'clip-dual': ['track-kick', 'clip-kick-a', 'clip-kick-b'],
            'clip-source-target': ['track-kick', 'clip-kick-a', 'clip-hat-target'],
            sidechain: ['track-kick', 'track-hat'],
        } as const;
        const items =
            order === 'parent-first'
                ? [removeTrack, { ...child, dependsOn: ['remove-kick'] }]
                : [child, { ...removeTrack, dependsOn: [child.id] }];

        expect(
            compileArbitraryCommandList({
                context: conflictContext,
                revision: `revision-${family}-${order}`,
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan: plan([...targetIdsByFamily[family]]),
                            list: { schemaVersion: 1, items },
                        },
                    },
                ],
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Structured command list contains contradictory mutation resources.',
        });
    });

    it('keeps sibling clip mutations composable when neither deletes their parent track', () => {
        const siblingContext = {
            ...context,
            tracks: context.tracks.map((track) =>
                track.id === 'track-kick'
                    ? {
                          ...track,
                          clipCount: 2,
                          clips: [
                              {
                                  id: 'clip-kick-a',
                                  name: 'Kick A',
                                  type: 'audio' as const,
                                  startBeat: 0,
                                  endBeat: 4,
                                  noteCount: 0,
                              },
                              {
                                  id: 'clip-kick-b',
                                  name: 'Kick B',
                                  type: 'audio' as const,
                                  startBeat: 4,
                                  endBeat: 8,
                                  noteCount: 0,
                              },
                          ],
                      }
                    : track
            ),
        };
        const result = compileArbitraryCommandList({
            context: siblingContext,
            revision: 'revision-sibling-clips',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['clip-kick-a', 'clip-kick-b']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'gain-kick-a',
                                    name: 'setClipGain',
                                    arguments: { gain: 0.5 },
                                    selector: {
                                        targetArgument: 'clipId',
                                        entity: 'clip',
                                        where: { name: 'Kick A' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                                {
                                    id: 'gain-kick-b',
                                    name: 'setClipGain',
                                    arguments: { gain: 0.75 },
                                    selector: {
                                        targetArgument: 'clipId',
                                        entity: 'clip',
                                        where: { name: 'Kick B' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                    dependsOn: ['gain-kick-a'],
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
    });

    it('derives duplicateClip parent scope from its registered target contract', () => {
        expect(
            compileArbitraryCommandList({
                context: duplicateClipContext,
                revision: 'revision-duplicate-clip',
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan: plan(['clip-kick-a']),
                            list: {
                                schemaVersion: 1,
                                items: [
                                    {
                                        id: 'duplicate-kick-a',
                                        name: 'duplicateClip',
                                        arguments: {},
                                        selector: {
                                            targetArgument: 'clipId',
                                            entity: 'clip',
                                            where: { name: 'Kick A' },
                                            quantity: { unit: 'targets', exactly: 1 },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            })
        ).toMatchObject({
            status: 'accepted',
            compilerEvidence: {
                commands: [{ name: 'duplicateClip', arguments: { clipId: 'clip-kick-a' } }],
            },
        });
    });

    it('compiles and replays addNotes for an unlocked empty MIDI clip with its parent-track identity', async () => {
        const calls = [
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: plan(['clip-empty-midi']),
                    list: {
                        schemaVersion: 1,
                        items: [
                            {
                                id: 'add-empty-midi-note',
                                name: 'addNotes',
                                arguments: { notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
                                selector: {
                                    targetArgument: 'clipId',
                                    entity: 'clip',
                                    where: { name: 'Empty MIDI' },
                                    quantity: { unit: 'targets', exactly: 1 },
                                },
                            },
                        ],
                    },
                },
            },
        ];
        const compiled = compileArbitraryCommandList({
            context: emptyMidiClipContext,
            revision: 'revision-empty-midi',
            calls,
        });

        expect(compiled).toMatchObject({
            status: 'accepted',
            compilerEvidence: {
                commands: [
                    {
                        name: 'addNotes',
                        arguments: {
                            clipId: 'clip-empty-midi',
                            notes: [{ pitch: 60, startBeat: 0, duration: 1 }],
                        },
                    },
                ],
            },
        });
        if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
            return;
        }
        expect(compiled.compilerEvidence.providerKnownTargetIds).toEqual(['clip-empty-midi']);
        expect(
            validateArbitraryCommandListEvidence({
                evidence: compiled.compilerEvidence,
                calls: compiled.compilerEvidence.commands,
                context: emptyMidiClipContext,
                revision: 'revision-empty-midi',
            })
        ).toMatchObject({
            status: 'accepted',
            targetOverridesByCallIndex: new Map([
                [
                    0,
                    [
                        {
                            argument: 'clipId',
                            capability: 'writable-midi-clip',
                            cardinality: 'one',
                            stableIds: ['clip-empty-midi'],
                        },
                    ],
                ],
            ]),
        });

        const agentReferenceCandidate = await import('../agentReference/isAgentReferenceCapabilityCandidate');
        const candidate = agentReferenceCandidate.isAgentReferenceCapabilityCandidate;
        vi.spyOn(agentReferenceCandidate, 'isAgentReferenceCapabilityCandidate').mockImplementation((input) =>
            input.capability === 'writable-midi-clip' ? false : candidate(input)
        );
        expect(
            compileArbitraryCommandList({
                context: emptyMidiClipContext,
                revision: 'revision-empty-midi',
                calls,
            })
        ).toMatchObject({ status: 'rejected', reason: expect.stringContaining('target') });
    });

    it('rejects addNotes compilation and evidence replay for a MIDI clip on a frozen track', () => {
        const calls = [
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: plan(['clip-empty-midi']),
                    list: {
                        schemaVersion: 1,
                        items: [
                            {
                                id: 'add-frozen-midi-note',
                                name: 'addNotes',
                                arguments: { notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
                                selector: {
                                    targetArgument: 'clipId',
                                    entity: 'clip',
                                    where: { name: 'Empty MIDI' },
                                    quantity: { unit: 'targets', exactly: 1 },
                                },
                            },
                        ],
                    },
                },
            },
        ];
        const frozenMidiClipContext = {
            ...emptyMidiClipContext,
            tracks: emptyMidiClipContext.tracks.map((track, index) =>
                index === 0 ? { ...track, frozen: true } : track
            ),
        };

        expect(
            compileArbitraryCommandList({
                context: frozenMidiClipContext,
                revision: 'revision-frozen-midi',
                calls,
            })
        ).toMatchObject({ status: 'rejected' });

        const compiled = compileArbitraryCommandList({
            context: emptyMidiClipContext,
            revision: 'revision-frozen-midi',
            calls,
        });
        expect(compiled).toMatchObject({ status: 'accepted' });
        if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
            return;
        }
        expect(
            validateArbitraryCommandListEvidence({
                evidence: compiled.compilerEvidence,
                calls: compiled.compilerEvidence.commands,
                context: frozenMidiClipContext,
                revision: 'revision-frozen-midi',
            })
        ).toMatchObject({ status: 'rejected' });
    });

    it('fails closed when an app-derived identity has no materialization contract', async () => {
        const commandUseCases = await import('#/modules/Command/useCases');
        const getGroundingRules = commandUseCases.getExecutableAppActionGroundingRules;
        vi.spyOn(commandUseCases, 'getExecutableAppActionGroundingRules').mockImplementation((actionType) => {
            const groundingRules = getGroundingRules(actionType);
            if (actionType !== 'duplicateClip' || groundingRules === null) {
                return groundingRules;
            }
            return { ...groundingRules, targetRules: [] };
        });
        expect(
            compileArbitraryCommandList({
                context: duplicateClipContext,
                revision: 'revision-missing-derived-materializer',
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan: plan([]),
                            list: {
                                schemaVersion: 1,
                                items: [
                                    {
                                        id: 'duplicate-kick-a',
                                        name: 'duplicateClip',
                                        arguments: { clipId: 'clip-kick-a' },
                                    },
                                ],
                            },
                        },
                    },
                ],
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Structured command app-derived mutation identity could not be materialized: parentTrackIds',
        });
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
        expect(result.compilerEvidence.providerKnownTargetIds).toEqual(['track-mix-bus', 'track-kick']);
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
                    scope: plan(result.compilerEvidence.providerKnownTargetIds).scope,
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
        const targetDevices = [
            { ...supportedSidechainDevice, id: 'compressor-a', name: 'First Compressor' },
            { ...supportedSidechainDevice, id: 'compressor-b', name: 'Second Compressor' },
        ];
        const result = compileArbitraryCommandList({
            context: {
                ...context,
                tracks: context.tracks.map((track) =>
                    track.id === 'track-hat'
                        ? { ...track, deviceCount: targetDevices.length, devices: targetDevices }
                        : track
                ),
            },
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'track-hat', 'compressor-a', 'compressor-b']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'route-to-first-compressor',
                                    name: 'addSidechainRoute',
                                    arguments: { sourceTrackId: 'track-kick', targetTrackId: 'track-hat' },
                                    selector: {
                                        targetArgument: 'targetDeviceId',
                                        entity: 'device',
                                        where: {
                                            name: 'First Compressor',
                                            trackId: 'track-hat',
                                            type: 'builtin-sidechain-compressor',
                                        },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                                {
                                    id: 'route-to-second-compressor',
                                    name: 'addSidechainRoute',
                                    arguments: { sourceTrackId: 'track-kick', targetTrackId: 'track-hat' },
                                    selector: {
                                        targetArgument: 'targetDeviceId',
                                        entity: 'device',
                                        where: {
                                            name: 'Second Compressor',
                                            trackId: 'track-hat',
                                            type: 'builtin-sidechain-compressor',
                                        },
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
        const targetDevice = { ...supportedSidechainDevice, id: 'compressor-a', name: 'First Compressor' };
        const result = compileArbitraryCommandList({
            context: {
                ...context,
                tracks: context.tracks.map((track) =>
                    track.id === 'track-hat' ? { ...track, deviceCount: 1, devices: [targetDevice] } : track
                ),
            },
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'track-hat', 'compressor-a']),
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'route-device',
                                    name: 'addSidechainRoute',
                                    arguments: { sourceTrackId: 'track-kick', targetTrackId: 'track-hat' },
                                    selector: {
                                        targetArgument: 'targetDeviceId',
                                        entity: 'device',
                                        where: {
                                            name: 'First Compressor',
                                            trackId: 'track-hat',
                                            type: 'builtin-sidechain-compressor',
                                        },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                                {
                                    id: 'reroute-device',
                                    name: 'addSidechainRoute',
                                    arguments: { sourceTrackId: 'track-kick', targetTrackId: 'track-hat' },
                                    selector: {
                                        targetArgument: 'targetDeviceId',
                                        entity: 'device',
                                        where: {
                                            name: 'First Compressor',
                                            trackId: 'track-hat',
                                            type: 'builtin-sidechain-compressor',
                                        },
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
            reason: 'Structured command writes for addSidechainRoute on compressor-a are not safely composable.',
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
            projectId: captureProjectIdentity(),
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
        expect(
            validateArbitraryCommandListEvidence({
                evidence: result.compilerEvidence!,
                calls: result.compilerEvidence!.commands,
                context: clipContext,
                revision: 'revision-1',
            }).status
        ).toBe('accepted');
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

    it('records selector targets without treating provider protections as selection authority', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'track-hat'], ['track-kick']),
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
                                        quantity: { unit: 'targets', exactly: 2 },
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
            stableIds: ['track-kick', 'track-hat'],
            protectedExclusions: [],
            preconditions: [
                expect.objectContaining({ stableId: 'track-kick' }),
                expect.objectContaining({ stableId: 'track-hat' }),
            ],
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
                revision: 'revision-1',
            }).status
        ).toBe('accepted');
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
        expect(
            validateArbitraryCommandListEvidence({
                evidence: {
                    ...result.compilerEvidence,
                    providerKnownTargetIds: ['track-hat'],
                },
                calls: result.compilerEvidence.commands,
                context,
                revision: 'revision-1',
            }).status
        ).toBe('rejected');
    });

    it('rejects an unbounded selector before it can enter the command bridge', () => {
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
                            items: [
                                {
                                    id: 'one',
                                    name: 'muteTrack',
                                    arguments: { muted: true },
                                    selector: { targetArgument: 'trackId', entity: 'track' },
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

    it('admits one semantic sidechain compressor selector without provider-supplied device IDs', () => {
        const result = compileSidechainDeviceSelector({});

        expect(result).toMatchObject({
            status: 'accepted',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        commands: [
                            {
                                name: 'addSidechainRoute',
                                arguments: {
                                    sourceTrackId: 'track-kick',
                                    targetTrackId: 'track-bass',
                                    targetDeviceId: 'device-bass-compressor',
                                },
                            },
                        ],
                    },
                },
            ],
        });
    });

    it.each([
        {
            name: 'provider-supplied device ID',
            devices: [supportedSidechainDevice],
            arguments_: { targetDeviceId: 'device-bass-compressor' },
            protectedTargetIds: [],
            expectedReason: 'Provider may not supply target IDs for a semantic bulk selector.',
        },
        {
            name: 'unsupported device',
            devices: [{ ...supportedSidechainDevice, id: 'device-bass-eq', name: 'Bass EQ', type: 'builtin-eq' }],
            arguments_: {},
            protectedTargetIds: [],
            expectedReason: 'Bulk selector resolved a target outside the command capability contract.',
        },
        {
            name: 'ambiguous device match',
            devices: [
                { ...supportedSidechainDevice, id: 'device-bass-compressor-a' },
                { ...supportedSidechainDevice, id: 'device-bass-compressor-b' },
            ],
            arguments_: {},
            protectedTargetIds: [],
            expectedReason: 'Bulk selector sidechain-bass resolved 2 targets, not its exact quantity.',
        },
    ])('rejects a $name sidechain selector', ({ devices, arguments_, protectedTargetIds, expectedReason }) => {
        const result = compileSidechainDeviceSelector({ devices, arguments_, protectedTargetIds });

        expect(result).toEqual({ status: 'rejected', reason: expectedReason });
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

    it('rejects a createBus binding as an addNotes writable MIDI clip target in compilation and evidence replay', () => {
        const calls = [
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
                                id: 'add-bus-note',
                                name: 'addNotes',
                                arguments: {
                                    clipId: '$drum-bus',
                                    notes: [{ pitch: 60, startBeat: 0, duration: 1 }],
                                },
                                dependsOn: ['create-drum-bus'],
                            },
                        ],
                    },
                },
            },
        ];
        expect(compileArbitraryCommandList({ context, revision: 'revision-1', calls })).toMatchObject({
            status: 'rejected',
            reason: expect.stringContaining('Batch-local target'),
        });

        const createBusCommand = { name: 'createBus', arguments: { name: 'Drum Bus', binding: 'drum-bus' } };
        const addNotesCommand = {
            name: 'addNotes',
            arguments: { clipId: '$drum-bus', notes: [{ duration: 1, pitch: 60, startBeat: 0 }] },
        };
        const evidence = {
            schemaVersion: 1 as const,
            snapshotRevision: 'revision-1',
            providerKnownTargetIds: [],
            selectors: [],
            commands: [createBusCommand, addNotesCommand],
            expandedMidiTransforms: [],
            items: [
                {
                    canonicalStableIds: [],
                    declaredCommandIdentities: [
                        '{"arguments":{"binding":"drum-bus","name":"Drum Bus"},"name":"createBus"}',
                    ],
                    itemId: 'create-drum-bus',
                    commandName: 'createBus',
                    dependsOn: [],
                    declaredCommandCount: 1,
                    omittedCommandCount: 0,
                    representativeCommandIndexes: [0],
                    stableIds: [],
                    commandStart: 0,
                    commandCount: 1,
                },
                {
                    canonicalStableIds: [],
                    declaredCommandIdentities: [
                        '{"arguments":{"clipId":"$drum-bus","notes":[{"duration":1,"pitch":60,"startBeat":0}]},"name":"addNotes"}',
                    ],
                    itemId: 'add-bus-note',
                    commandName: 'addNotes',
                    dependsOn: ['create-drum-bus'],
                    declaredCommandCount: 1,
                    omittedCommandCount: 0,
                    representativeCommandIndexes: [1],
                    stableIds: [],
                    commandStart: 1,
                    commandCount: 1,
                },
            ],
        };

        expect(
            validateArbitraryCommandListEvidence({
                evidence,
                calls: evidence.commands,
                context,
                revision: 'revision-1',
            })
        ).toMatchObject({ status: 'rejected', reason: expect.stringContaining('batch-local target') });
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
            projectId: captureProjectIdentity(),
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

    it('refuses an unbounded malformed batch-local target reference without quoting it back', () => {
        const hostileReference = `$${'a'.repeat(1000)}`;

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
                                    id: 'gain-drum-bus',
                                    name: 'setTrackGain',
                                    arguments: { trackId: hostileReference, gain: 0.8 },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        expect(result).toEqual({ status: 'rejected', reason: 'Malformed batch-local target reference.' });
        expect(JSON.stringify(result)).not.toContain(hostileReference);
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

    it('records every resolved many-target identity independently of provider protections', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-1',
            calls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        plan: plan(['track-kick', 'track-hat'], ['track-kick']),
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
        expect(result.compilerEvidence.commands[0]?.arguments.trackIds).toEqual(['track-kick', 'track-hat']);
        expect(result.compilerEvidence.selectors[0]?.protectedExclusions).toEqual([]);
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

    it('rejects many-target direct IDs and records selector resolution independently of proposal targets', () => {
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
        expect(enlarged).toMatchObject({
            status: 'accepted',
            compilerEvidence: { providerKnownTargetIds: ['track-kick', 'track-hat'] },
        });
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

    const creationProposal = (items: ReadonlyArray<Record<string, unknown>>, scopeIds: string[] = []) => ({
        name: 'command.batch.propose',
        arguments: { plan: plan(scopeIds), list: { schemaVersion: 1, items } },
    });

    const creationChainItems = [
        { id: 'make-track', name: 'addTrack', arguments: { name: 'Piano', kind: 'midi', binding: 'piano' } },
        {
            id: 'make-clip',
            name: 'addClip',
            arguments: { trackId: '$piano', startBeat: 0, endBeat: 4, name: 'Melody', binding: 'melody' },
            dependsOn: ['make-track'],
        },
        {
            id: 'add-notes',
            name: 'addNotes',
            arguments: { clipId: '$melody', notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
            dependsOn: ['make-clip'],
        },
    ];

    it('compiles an addTrack and addClip producer chain and replays typed producer arguments from evidence', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-creation',
            calls: [creationProposal(creationChainItems)],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        expect(result.compilerEvidence.commands).toEqual([
            { name: 'addTrack', arguments: { name: 'Piano', kind: 'midi', binding: 'piano' } },
            {
                name: 'addClip',
                arguments: { trackId: '$piano', startBeat: 0, endBeat: 4, name: 'Melody', binding: 'melody' },
            },
            {
                name: 'addNotes',
                arguments: { clipId: '$melody', notes: [{ duration: 1, pitch: 60, startBeat: 0 }] },
            },
        ]);

        const replayed = validateArbitraryCommandListEvidence({
            evidence: result.compilerEvidence,
            calls: result.compilerEvidence.commands,
            context,
            revision: 'revision-creation',
        });
        expect(replayed).toMatchObject({ status: 'accepted' });
        if (replayed.status !== 'accepted') {
            return;
        }
        expect(replayed.actionCommandGraph.batchLocalBindings).toEqual([
            { bindingId: '$piano', producerActionIndex: 0, producerArgument: 'id' },
            { bindingId: '$melody', producerActionIndex: 1, producerArgument: 'id' },
        ]);
    });

    it('accepts a newly created bound device as a setDeviceParameter target', () => {
        const deviceContext: ProjectContext = {
            ...context,
            availableDeviceTypes: [
                {
                    id: 'builtin-filter',
                    name: 'Filter',
                    parameters: [
                        {
                            id: 'filter-type',
                            name: 'Type',
                            type: 'choice',
                            value: 0,
                            minValue: 0,
                            maxValue: 3,
                            unit: '',
                            choices: ['Lowpass', 'Highpass', 'Bandpass', 'Notch'],
                        },
                    ],
                },
            ],
        };
        const result = compileArbitraryCommandList({
            context: deviceContext,
            revision: 'revision-created-device-parameter',
            calls: [
                creationProposal([
                    { id: 'make-lead', name: 'addTrack', arguments: { name: 'Lead', kind: 'midi', binding: 'lead' } },
                    {
                        id: 'add-radio',
                        name: 'addDevice',
                        arguments: { trackId: '$lead', deviceType: 'builtin-filter', binding: 'radio' },
                        dependsOn: ['make-lead'],
                    },
                    {
                        id: 'set-radio-type',
                        name: 'setDeviceParameter',
                        arguments: { deviceId: '$radio', paramId: 'filter-type', value: 1 },
                        dependsOn: ['add-radio'],
                    },
                ]),
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            throw new Error('Expected compiler evidence for a created device parameter chain');
        }
        const replayed = validateArbitraryCommandListEvidence({
            evidence: result.compilerEvidence,
            calls: result.compilerEvidence.commands,
            context: deviceContext,
            revision: 'revision-created-device-parameter',
        });
        expect(replayed).toMatchObject({ status: 'accepted' });
        if (replayed.status === 'accepted') {
            expect(replayed.actionCommandGraph).toEqual({
                dependenciesByActionIndex: [[], [0], [1]],
                batchLocalBindings: [
                    { bindingId: '$lead', producerActionIndex: 0, producerArgument: 'id' },
                    { bindingId: '$radio', producerActionIndex: 1, producerArgument: 'deviceId' },
                ],
            });
        }

        const tamperedParameter = structuredClone(result.compilerEvidence);
        const parameterCommand = tamperedParameter.commands[2];
        if (parameterCommand === undefined) {
            throw new Error('Expected a parameter command to tamper with');
        }
        tamperedParameter.commands[2] = {
            ...parameterCommand,
            arguments: { deviceId: '$radio', paramId: 'unknown-parameter', value: 1 },
        };
        expect(
            validateArbitraryCommandListEvidence({
                evidence: tamperedParameter,
                calls: tamperedParameter.commands,
                context: deviceContext,
                revision: 'revision-created-device-parameter',
            })
        ).toMatchObject({
            status: 'rejected',
            reason: 'Structured command compiler evidence order or dependencies are invalid.',
        });

        const unsupportedParameter = structuredClone(result.compilerEvidence);
        const unsupportedParameterCommand = unsupportedParameter.commands[2];
        const unsupportedParameterItem = unsupportedParameter.items[2];
        if (unsupportedParameterCommand === undefined || unsupportedParameterItem === undefined) {
            throw new Error('Expected a parameter command and item to tamper with');
        }
        unsupportedParameter.commands[2] = {
            ...unsupportedParameterCommand,
            arguments: { deviceId: '$radio', paramId: 'unknown-parameter', value: 1 },
        };
        unsupportedParameter.items[2] = {
            ...unsupportedParameterItem,
            declaredCommandIdentities: [
                '{"arguments":{"deviceId":"$radio","paramId":"unknown-parameter","value":1},"name":"setDeviceParameter"}',
            ],
        };
        expect(
            validateArbitraryCommandListEvidence({
                evidence: unsupportedParameter,
                calls: unsupportedParameter.commands,
                context: deviceContext,
                revision: 'revision-created-device-parameter',
            })
        ).toMatchObject({
            status: 'rejected',
            reason: 'Structured command compiler evidence batch-local device parameter is invalid.',
        });

        const tamperedDependency = structuredClone(result.compilerEvidence);
        const parameterItem = tamperedDependency.items[2];
        if (parameterItem === undefined) {
            throw new Error('Expected a parameter item to tamper with');
        }
        tamperedDependency.items[2] = { ...parameterItem, dependsOn: [] };
        expect(
            validateArbitraryCommandListEvidence({
                evidence: tamperedDependency,
                calls: tamperedDependency.commands,
                context: deviceContext,
                revision: 'revision-created-device-parameter',
            })
        ).toMatchObject({ status: 'rejected' });

        const tamperedProducer = structuredClone(result.compilerEvidence);
        const producerCommand = tamperedProducer.commands[1];
        if (producerCommand === undefined) {
            throw new Error('Expected a device producer command to tamper with');
        }
        tamperedProducer.commands[1] = {
            ...producerCommand,
            arguments: { trackId: '$lead', deviceType: 'unknown-device', binding: 'radio' },
        };
        expect(
            validateArbitraryCommandListEvidence({
                evidence: tamperedProducer,
                calls: tamperedProducer.commands,
                context: deviceContext,
                revision: 'revision-created-device-parameter',
            })
        ).toMatchObject({ status: 'rejected' });

        const unknownParameter = compileArbitraryCommandList({
            context: deviceContext,
            revision: 'revision-created-device-parameter',
            calls: [
                creationProposal([
                    {
                        id: 'make-lead',
                        name: 'addTrack',
                        arguments: { name: 'Lead', kind: 'midi', binding: 'lead' },
                    },
                    {
                        id: 'add-filter',
                        name: 'addDevice',
                        arguments: { trackId: '$lead', deviceType: 'builtin-filter', binding: 'filter' },
                        dependsOn: ['make-lead'],
                    },
                    {
                        id: 'set-unknown-parameter',
                        name: 'setDeviceParameter',
                        arguments: { deviceId: '$filter', paramId: 'unknown-parameter', value: 1 },
                        dependsOn: ['add-filter'],
                    },
                ]),
            ],
        });
        expect(unknownParameter).toMatchObject({ status: 'rejected' });
        expect(JSON.stringify(unknownParameter)).not.toMatch(/(?:track|device)-ai-/u);
    });

    it.each([
        {
            accepted: true,
            kind: 'midi',
            name: 'grants a created midi track the device-host-track capability',
            scopeIds: [],
            consumers: [
                {
                    id: 'host',
                    name: 'addDevice',
                    arguments: { trackId: '$made', deviceType: 'builtin-reverb' },
                    dependsOn: ['make'],
                },
            ],
        },
        {
            accepted: false,
            kind: 'midi',
            name: 'withholds the output capability from a created midi track',
            scopeIds: ['track-hat'],
            consumers: [
                {
                    id: 'route',
                    name: 'setTrackOutput',
                    arguments: { trackId: 'track-hat', outputId: '$made' },
                    dependsOn: ['make'],
                },
            ],
        },
        {
            accepted: false,
            kind: 'midi',
            name: 'withholds the bus capability from a created midi track',
            scopeIds: ['track-hat'],
            consumers: [
                {
                    id: 'send',
                    name: 'addSend',
                    arguments: { trackId: 'track-hat', busId: '$made', level: 0.25 },
                    dependsOn: ['make'],
                },
            ],
        },
        {
            accepted: true,
            kind: 'audio',
            name: 'grants a created audio track the routable-source capability',
            scopeIds: [],
            consumers: [
                { id: 'make-sink', name: 'createBus', arguments: { name: 'Sink', binding: 'sink' } },
                {
                    id: 'route',
                    name: 'setTrackOutput',
                    arguments: { trackId: '$made', outputId: '$sink' },
                    dependsOn: ['make', 'make-sink'],
                },
            ],
        },
        {
            accepted: false,
            kind: 'folder',
            name: 'withholds the routable-source capability from a created folder track',
            scopeIds: [],
            consumers: [
                { id: 'make-sink', name: 'createBus', arguments: { name: 'Sink', binding: 'sink' } },
                {
                    id: 'route',
                    name: 'setTrackOutput',
                    arguments: { trackId: '$made', outputId: '$sink' },
                    dependsOn: ['make', 'make-sink'],
                },
            ],
        },
    ])('$name', ({ accepted, consumers, kind, scopeIds }) => {
        const result = compileArbitraryCommandList({
            context: { ...context, availableDeviceTypes: [{ id: 'builtin-reverb', name: 'Reverb' }] },
            revision: 'revision-track-kind',
            calls: [
                creationProposal(
                    [
                        { id: 'make', name: 'addTrack', arguments: { name: 'Made', kind, binding: 'made' } },
                        ...consumers,
                    ],
                    scopeIds
                ),
            ],
        });

        expect(result.status).toBe(accepted ? 'accepted' : 'rejected');
    });

    it.each([
        {
            accepted: true,
            capability: 'writable-midi-clip',
            consumer: 'addNotes',
            reason: null,
            trackKind: 'midi',
        },
        {
            accepted: false,
            capability: 'editable-midi-clip',
            consumer: 'quantizeNotes',
            reason: 'Batch-local target $fresh requires an earlier bounded producer dependency.',
            trackKind: 'midi',
        },
        {
            accepted: false,
            capability: 'editable-audio-clip',
            consumer: 'normalizeClip',
            reason: 'Batch-local binding producer does not create a typed object: fresh',
            trackKind: 'audio',
        },
        {
            accepted: false,
            capability: 'editable-audio-clip',
            consumer: 'normalizeClip',
            reason: 'Batch-local binding producer does not create a typed object: fresh',
            trackKind: 'bus',
        },
    ])(
        'admits a freshly created clip as $capability on a $trackKind parent: $accepted',
        ({ accepted, consumer, reason, trackKind }) => {
            const consumerArguments: Record<string, Record<string, unknown>> = {
                addNotes: { clipId: '$fresh', notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
                normalizeClip: { clipId: '$fresh' },
                quantizeNotes: { clipId: '$fresh', gridSize: 1 },
            };
            const parentItem =
                trackKind === 'bus'
                    ? { id: 'make-parent', name: 'createBus', arguments: { name: 'Made', binding: 'made' } }
                    : {
                          id: 'make-parent',
                          name: 'addTrack',
                          arguments: { name: 'Made', kind: trackKind, binding: 'made' },
                      };

            const result = compileArbitraryCommandList({
                context,
                revision: 'revision-clip-kind',
                calls: [
                    creationProposal([
                        parentItem,
                        {
                            id: 'make-clip',
                            name: 'addClip',
                            arguments: {
                                trackId: '$made',
                                startBeat: 0,
                                endBeat: 4,
                                name: 'Fresh',
                                binding: 'fresh',
                            },
                            dependsOn: ['make-parent'],
                        },
                        {
                            id: 'consume-clip',
                            name: consumer,
                            arguments: consumerArguments[consumer]!,
                            dependsOn: ['make-clip'],
                        },
                    ]),
                ],
            });

            if (accepted) {
                expect(result).toMatchObject({ status: 'accepted' });
                return;
            }
            expect(result).toMatchObject({ status: 'rejected', reason });
        }
    );

    it('refuses a batch that deletes the track its own batch-local clip is created on', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-parent-conflict',
            calls: [
                creationProposal([
                    ...creationChainItems,
                    {
                        id: 'drop-track',
                        name: 'removeTrack',
                        arguments: { trackId: '$piano' },
                        dependsOn: ['add-notes'],
                    },
                ]),
            ],
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Structured command list contains contradictory mutation resources.',
        });
    });

    const trackCreationItems = (count: number) =>
        Array.from({ length: count }, (_unused, index) => ({
            id: `make-track-${String(index)}`,
            name: 'addTrack',
            arguments: { name: `Layer ${String(index)}`, kind: 'midi', binding: `layer${String(index)}` },
        }));

    it('accepts a list that creates exactly as many project objects as the creation budget allows', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-creation-budget',
            calls: [creationProposal(trackCreationItems(SEMANTIC_COMMAND_LIST_MAX_CREATIONS))],
        });

        expect(result).toMatchObject({ status: 'accepted' });
    });

    it('refuses a list that creates one more project object than the creation budget allows', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-creation-budget',
            calls: [creationProposal(trackCreationItems(SEMANTIC_COMMAND_LIST_MAX_CREATIONS + 1))],
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: `Semantic command list creates more than ${String(SEMANTIC_COMMAND_LIST_MAX_CREATIONS)} project objects`,
        });
    });

    it('counts every command a repeat expands to against the creation budget', () => {
        const repeatCount = 3;
        const items = [
            ...trackCreationItems(SEMANTIC_COMMAND_LIST_MAX_CREATIONS - repeatCount + 1),
            {
                id: 'make-repeated',
                name: 'addTrack',
                arguments: { name: 'Repeated', kind: 'midi' },
                repeat: { count: repeatCount },
            },
        ];

        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-creation-budget',
            calls: [creationProposal(items)],
        });

        // The unexpanded list holds fewer items than the budget; only the expansion exceeds it.
        expect(items.length).toBeLessThanOrEqual(SEMANTIC_COMMAND_LIST_MAX_CREATIONS);
        expect(result).toMatchObject({
            status: 'rejected',
            reason: `Semantic command list creates more than ${String(SEMANTIC_COMMAND_LIST_MAX_CREATIONS)} project objects`,
        });
    });

    it('mints and preserves one typed track and clip identity across bridging, preview, and partial acceptance', async () => {
        const intent =
            'Add a midi track named Piano and add a midi clip named Melody on the Piano track from beat 0 to beat 4.';
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-typed-creation',
            calls: [creationProposal(creationChainItems.slice(0, 2))],
        });
        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }

        const bridged = bridgeGroundedLlmToolCalls({
            calls: result.compilerEvidence.commands,
            compilerEvidence: result.compilerEvidence,
            context,
            projectRevision: 'revision-typed-creation',
            prompt: intent,
        });
        expect(bridged.rejections).toEqual([]);
        expect(bridged.actionCommandGraph?.dependenciesByActionIndex).toEqual([[], [0]]);

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
        const [createdTrack, createdClip] = guarded.actions;
        if (createdTrack?.type !== 'addTrack' || createdClip?.type !== 'addClip') {
            throw new Error('Expected the creation chain to keep its addTrack and addClip shape');
        }
        const trackId = createdTrack.payload.id;
        const clipId = createdClip.payload.id;
        if (trackId === undefined || clipId === undefined) {
            throw new Error('Expected both creations to carry an application-minted identity');
        }
        expect(trackId).toMatch(/^track-ai-[\da-f-]{36}$/u);
        expect(clipId).toMatch(/^clip-ai-[\da-f-]{36}$/u);
        expect(createdClip.payload.trackId).toBe(trackId);

        const creationHandler = {
            describe: () => ({ label: 'Create' }),
            execute: () => ({ status: 'written' as const }),
            previewExecution: 'isolated-project' as const,
            undoable: true,
            validate: () => true,
        };
        registerHandlerMap({ addTrack: creationHandler, addClip: creationHandler });
        commandTrackDefaultsPort.setTrackColorProvider(() => '#123456');
        commandBatchPreflightPort.setProvider(({ projectDocument }) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: captureProjectIdentity(),
            projectInvariantsValid: true,
            targetFingerprints:
                projectDocument === undefined ? {} : { [trackId]: 'created-track', [clipId]: 'created-clip' },
        }));
        commandBatchPreviewPort.setProvider(() => ({
            getProjectDocument: () => ({}),
            release: () => undefined,
            scope: (callback) => callback(),
        }));

        const compiled = compilePlannedActionCommandBatch({
            actions: guarded.actions,
            actionLabels: ['Add Piano', 'Add Melody'],
            actionCommandGraph: bridged.actionCommandGraph,
            autoCommit: false,
            context,
            group: { groupId: 'group-typed-creation', groupLabel: 'Add Piano' },
            intent,
            mode: 'preview' as const,
            projectRevision: 'revision-typed-creation',
            runId: 'run-typed-creation',
        });
        const parsed = parseVersionedCommandBatchEnvelope(compiled.commandBatch.serialized);
        expect(parsed.status).toBe('valid');
        if (parsed.status !== 'valid') {
            return;
        }
        const [trackCommand, clipCommand] = parsed.envelope.commands;
        expect(parsed.envelope.batchLocalBindings).toEqual([
            { bindingId: '$piano', producerArgument: 'id', producerCommandId: trackCommand?.commandId },
            { bindingId: '$melody', producerArgument: 'id', producerCommandId: clipCommand?.commandId },
        ]);
        expect(trackCommand?.applicationAssignedIds).toContainEqual({ argument: 'id', value: trackId });
        expect(clipCommand?.applicationAssignedIds).toContainEqual({ argument: 'id', value: clipId });
        expect(compiled.commandBatch.authority.scope.targetIds).toEqual([trackId]);

        const preview = await executeVersionedCommandBatchEnvelope({
            authority: compiled.commandBatch.authority,
            serialized: compiled.commandBatch.serialized,
        });
        expect(preview.status).toBe('previewed');
        if (preview.status !== 'previewed' || clipCommand === undefined) {
            return;
        }
        const partial = compilePartialCommandBatchAcceptance({
            batchId: 'group-typed-creation-partial',
            previewSelection: preview.partialAcceptance,
            runId: 'run-typed-creation-partial',
            selectedIntentGroupIds: [clipCommand.commandId],
        });
        expect(partial).toMatchObject({
            status: 'compiled',
            includedOriginalCommandIds: parsed.envelope.commands.map((command) => command.commandId),
        });
        preview.resource.release();
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
