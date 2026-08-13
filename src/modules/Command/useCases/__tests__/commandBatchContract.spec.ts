import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { type AppAction } from '#/utils/handlerContract';

import { type CommandBatchAuthority } from '../../models/VersionedCommandBatchEnvelope';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { executeVersionedCommandBatchEnvelope } from '../executeVersionedCommandBatchEnvelope';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { resolveVersionedCommandBatchBindings } from '../resolveVersionedCommandBatchBindings';
import { serializeVersionedCommandBatchEnvelope } from '../serializeVersionedCommandBatchEnvelope';

const GAIN_COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const PAN_COMMAND_ID = '22222222-2222-4222-8222-222222222222';

function actionCommand(input: { action: AppAction; commandId: string; dependencyIds?: readonly string[] }) {
    return {
        ...createExecutionCommandEnvelope({
            action: input.action,
            dependencyIds: input.dependencyIds,
            expectedEffect: `Execute ${input.action.type}`,
            normalizedProjectRevision: 'revision-1',
        }).envelope,
        commandId: input.commandId,
    };
}

function command(input: {
    commandId: string;
    dependencyIds?: readonly string[];
    operation: 'setTrackGain' | 'setTrackPan';
    targetId: string;
    value: number;
}) {
    const action =
        input.operation === 'setTrackGain'
            ? ({
                  type: 'setTrackGain',
                  payload: { trackId: input.targetId, gain: input.value, expectedGain: 1 },
              } as const)
            : ({
                  type: 'setTrackPan',
                  payload: { trackId: input.targetId, pan: input.value, expectedPan: 0 },
              } as const);
    return actionCommand({ action, commandId: input.commandId, dependencyIds: input.dependencyIds });
}

function batch(overrides: Record<string, unknown> = {}) {
    const commands = [
        command({ commandId: GAIN_COMMAND_ID, operation: 'setTrackGain', targetId: 'track-vocal', value: 0.8 }),
        command({
            commandId: PAN_COMMAND_ID,
            dependencyIds: [GAIN_COMMAND_ID],
            operation: 'setTrackPan',
            targetId: 'track-guitar',
            value: -0.2,
        }),
    ];
    return {
        schemaVersion: 1,
        runId: 'run-1',
        batchId: 'batch-1',
        projectId: 'project-1',
        baseRevision: 'revision-1',
        idempotencyKey: 'idempotency-1',
        intent: 'Balance vocal and guitar',
        mode: 'preview',
        scope: {
            targetIds: ['track-vocal', 'track-guitar'],
            targetRanges: [],
            protectedTargetIds: ['track-drums'],
            protectedRanges: [{ startBeat: 32, endBeat: 48 }],
        },
        preconditions: [
            { kind: 'project-revision', value: 'revision-1' },
            { kind: 'targets-exist', targetIds: ['track-vocal', 'track-guitar'] },
        ],
        commands,
        postconditions: [
            { kind: 'project-invariants-valid' },
            { kind: 'audio-graph-valid' },
            { kind: 'targets-unchanged', targetIds: ['track-drums'] },
        ],
        dependencies: [{ commandId: PAN_COMMAND_ID, dependsOn: [GAIN_COMMAND_ID] }],
        batchLocalBindings: [],
        grants: {
            allowedOperationPrefixes: ['setTrack'],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: false,
        },
        budgets: {
            maxCommands: 2,
            maxCreatedTracks: 0,
            maxDeletedObjects: 0,
            maxAffectedTracks: 2,
            maxAffectedClips: 0,
            maxAutomationPoints: 0,
            maxImportedAssets: 0,
            maxRenderJobs: 0,
        },
        ...overrides,
    };
}

function authority(input: ReturnType<typeof batch>): CommandBatchAuthority {
    return {
        projectId: input.projectId,
        baseRevision: input.baseRevision,
        scope: input.scope,
        grants: input.grants,
        budgets: input.budgets,
    };
}

describe('command batch contract', () => {
    afterEach(() => {
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
    });

    it('accepts one complete schema-versioned ordered batch', () => {
        const parsed = parseVersionedCommandBatchEnvelope(JSON.stringify(batch()));
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }

        expect(parsed).toMatchObject({
            status: 'valid',
            envelope: {
                runId: 'run-1',
                batchId: 'batch-1',
                mode: 'preview',
                commands: [{ commandId: GAIN_COMMAND_ID }, { commandId: PAN_COMMAND_ID }],
            },
        });
        expect(parseVersionedCommandBatchEnvelope(serializeVersionedCommandBatchEnvelope(parsed.envelope))).toEqual(
            parsed
        );
    });

    it('compiles application-owned batch authority from materialized commands', () => {
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-compiled',
            batchId: 'batch-compiled',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Balance vocal and guitar',
            commands: batch().commands.map((entry) => JSON.stringify(entry)),
            protectedTargetIds: ['track-drums'],
        });
        const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }

        expect(parsed.envelope).toMatchObject({
            schemaVersion: 1,
            runId: 'run-compiled',
            batchId: 'batch-compiled',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            idempotencyKey: 'run-compiled:batch-compiled:revision-1',
            intent: 'Balance vocal and guitar',
            mode: 'commit',
            scope: {
                targetIds: ['track-vocal', 'track-guitar'],
                targetRanges: [],
                protectedTargetIds: ['track-drums'],
                protectedRanges: [],
            },
            preconditions: [
                { kind: 'project-revision', value: 'revision-1' },
                { kind: 'targets-exist', targetIds: ['track-vocal', 'track-guitar'] },
            ],
            postconditions: [
                { kind: 'project-invariants-valid' },
                { kind: 'audio-graph-valid' },
                { kind: 'targets-unchanged', targetIds: ['track-drums'] },
            ],
            dependencies: [{ commandId: PAN_COMMAND_ID, dependsOn: [GAIN_COMMAND_ID] }],
            grants: {
                allowedOperationPrefixes: ['setTrackGain', 'setTrackPan'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: {
                maxCommands: 2,
                maxCreatedTracks: 0,
                maxDeletedObjects: 0,
                maxAffectedTracks: 2,
                maxAffectedClips: 0,
                maxAutomationPoints: 0,
                maxImportedAssets: 0,
                maxRenderJobs: 0,
            },
        });
        expect(compiled.authority).toEqual({
            projectId: parsed.envelope.projectId,
            baseRevision: parsed.envelope.baseRevision,
            scope: parsed.envelope.scope,
            grants: parsed.envelope.grants,
            budgets: parsed.envelope.budgets,
        });
    });

    it('requires application-owned cascade bounds for track removal', () => {
        const removeTrackCommand = actionCommand({
            action: {
                type: 'removeTrack',
                payload: {
                    trackId: 'track-empty',
                    expectedKind: 'audio',
                    expectedMuted: true,
                    expectedClipIds: ['clip-guard'],
                    expectedAlternativeClipIds: ['alternative-clip-guard'],
                },
            },
            commandId: GAIN_COMMAND_ID,
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-remove',
            batchId: 'batch-remove',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Remove the empty track',
            commands: [JSON.stringify(removeTrackCommand)],
            dynamicEffects: {
                affectedTrackIds: ['track-empty'],
                affectedClipIds: ['clip-guard', 'alternative-clip-guard'],
            },
        });
        const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }

        expect(parsed.envelope.scope).toEqual({
            targetIds: ['track-empty', 'clip-guard', 'alternative-clip-guard'],
            targetRanges: [],
            protectedTargetIds: [],
            protectedRanges: [],
        });
        expect(parsed.envelope.budgets).toMatchObject({ maxCommands: 1, maxDeletedObjects: 3 });
    });

    it('rejects a model-enlarged target outside the application-issued scope', () => {
        const enlarged = batch({
            scope: {
                targetIds: ['track-vocal'],
                targetRanges: [],
                protectedTargetIds: ['track-guitar', 'track-drums'],
                protectedRanges: [],
            },
        });

        expect(parseVersionedCommandBatchEnvelope(JSON.stringify(enlarged))).toEqual({
            status: 'invalid',
            reason: 'Command target track-guitar is outside the declared batch scope',
        });
    });

    it('rejects any model-enlarged grant, budget, or protected scope bound', () => {
        const issued = batch();
        const enlargedBatches = [
            batch({ grants: { ...issued.grants, remoteGeneration: true } }),
            batch({ budgets: { ...issued.budgets, maxCommands: 3 } }),
            batch({
                scope: {
                    ...issued.scope,
                    protectedTargetIds: [...issued.scope.protectedTargetIds, 'track-extra'],
                },
            }),
        ];

        for (const enlarged of enlargedBatches) {
            expect(parseVersionedCommandBatchEnvelope(JSON.stringify(enlarged), authority(issued))).toEqual({
                status: 'invalid',
                reason: 'Command batch exceeds application-issued authority',
            });
        }
    });

    it('enforces operation-prefix grants independently', () => {
        const disallowedPrefix = batch({
            grants: { ...batch().grants, allowedOperationPrefixes: ['setTrackGain'] },
        });

        expect(parseVersionedCommandBatchEnvelope(JSON.stringify(disallowedPrefix))).toEqual({
            status: 'invalid',
            reason: 'Command operation prefix is not granted: setTrackPan',
        });
    });

    it('enforces routing authority independently from create authority', () => {
        const send = actionCommand({
            action: {
                type: 'addSend',
                payload: { trackId: 'track-vocal', busId: 'bus-fx', level: 0.5, preFader: false },
            },
            commandId: '33333333-3333-4333-8333-333333333333',
        });
        const input = batch({
            commands: [send],
            dependencies: [],
            postconditions: [],
            scope: {
                targetIds: ['track-vocal', 'bus-fx'],
                targetRanges: [],
                protectedTargetIds: [],
                protectedRanges: [],
            },
            grants: {
                ...batch().grants,
                allowedOperationPrefixes: ['addSend'],
                create: true,
                routing: false,
            },
            budgets: { ...batch().budgets, maxCommands: 1 },
        });

        expect(parseVersionedCommandBatchEnvelope(JSON.stringify(input))).toEqual({
            status: 'invalid',
            reason: 'Command batch requires the routing grant',
        });
    });

    it('rejects command time outside allowed ranges and inside protected ranges', () => {
        const point = actionCommand({
            action: { type: 'addAutomationPoint', payload: { laneId: 'lane-gain', beat: 12, value: 0.7 } },
            commandId: '44444444-4444-4444-8444-444444444444',
        });
        const input = batch({
            commands: [point],
            dependencies: [],
            postconditions: [],
            scope: {
                targetIds: ['lane-gain'],
                targetRanges: [{ startBeat: 0, endBeat: 8 }],
                protectedTargetIds: [],
                protectedRanges: [],
            },
            grants: {
                ...batch().grants,
                allowedOperationPrefixes: ['addAutomationPoint'],
                create: true,
            },
            budgets: { ...batch().budgets, maxCommands: 1, maxAutomationPoints: 1 },
        });

        expect(parseVersionedCommandBatchEnvelope(JSON.stringify(input))).toEqual({
            status: 'invalid',
            reason: 'Command time 12 beats is outside the declared batch scope',
        });

        const protectedInput = batch({
            ...input,
            scope: {
                targetIds: ['lane-gain'],
                targetRanges: [{ startBeat: 0, endBeat: 16 }],
                protectedTargetIds: [],
                protectedRanges: [{ startBeat: 8, endBeat: 16 }],
            },
        });
        expect(parseVersionedCommandBatchEnvelope(JSON.stringify(protectedInput))).toEqual({
            status: 'invalid',
            reason: 'Command time 12 beats is outside the declared batch scope',
        });
    });

    it('rejects an independently exceeded command or affected-track budget', () => {
        const commandBudget = batch({ budgets: { ...batch().budgets, maxCommands: 1 } });
        const trackBudget = batch({ budgets: { ...batch().budgets, maxAffectedTracks: 1 } });

        expect(parseVersionedCommandBatchEnvelope(JSON.stringify(commandBudget))).toEqual({
            status: 'invalid',
            reason: 'Command batch exceeds maxCommands',
        });
        expect(parseVersionedCommandBatchEnvelope(JSON.stringify(trackBudget))).toEqual({
            status: 'invalid',
            reason: 'Command batch exceeds maxAffectedTracks',
        });
    });

    it('rejects dependency metadata that disagrees with command order', () => {
        const invalid = batch({
            dependencies: [{ commandId: GAIN_COMMAND_ID, dependsOn: [PAN_COMMAND_ID] }],
        });

        expect(parseVersionedCommandBatchEnvelope(JSON.stringify(invalid))).toEqual({
            status: 'invalid',
            reason: `Batch dependencies are missing or out of order for ${GAIN_COMMAND_ID}`,
        });
    });

    it('resolves only declared earlier batch-local application identities', () => {
        const producerId = '55555555-5555-4555-8555-555555555555';
        const consumerId = '66666666-6666-4666-8666-666666666666';
        const producer = actionCommand({
            action: {
                type: 'createBus',
                payload: {
                    name: '$fx',
                    busId: 'bus-real',
                    color: '#123456',
                    initialAlternativeId: 'alternative-real',
                },
            },
            commandId: producerId,
        });
        const consumer = actionCommand({
            action: {
                type: 'addSend',
                payload: { trackId: 'track-vocal', busId: '$fx', level: 0.5, preFader: false },
            },
            commandId: consumerId,
            dependencyIds: [producerId],
        });
        const input = batch({
            commands: [producer, consumer],
            dependencies: [{ commandId: consumerId, dependsOn: [producerId] }],
            batchLocalBindings: [{ bindingId: '$fx', producerArgument: 'busId', producerCommandId: producerId }],
            scope: {
                targetIds: ['track-vocal'],
                targetRanges: [],
                protectedTargetIds: [],
                protectedRanges: [],
            },
            preconditions: [
                { kind: 'project-revision', value: 'revision-1' },
                { kind: 'targets-exist', targetIds: ['track-vocal'] },
            ],
            postconditions: [{ kind: 'project-invariants-valid' }, { kind: 'audio-graph-valid' }],
            grants: {
                ...batch().grants,
                allowedOperationPrefixes: ['createBus', 'addSend'],
                create: true,
                routing: true,
            },
            budgets: { ...batch().budgets, maxCreatedTracks: 1 },
        });

        const parsed = parseVersionedCommandBatchEnvelope(JSON.stringify(input));
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }

        const resolved = resolveVersionedCommandBatchBindings(parsed.envelope)[1];
        expect(resolveVersionedCommandBatchBindings(parsed.envelope)[0]?.arguments).toMatchObject({ name: '$fx' });
        expect(resolved).toMatchObject({
            arguments: { trackId: 'track-vocal', busId: 'bus-real', level: 0.5 },
        });
        expect(resolved?.objectReferences).toContainEqual({ argument: 'busId', id: 'bus-real', scope: 'stable' });

        const missingDependency = {
            ...input,
            commands: [producer, { ...consumer, dependencyIds: [] }],
            dependencies: [],
        };
        expect(parseVersionedCommandBatchEnvelope(JSON.stringify(missingDependency))).toEqual({
            status: 'invalid',
            reason: 'Batch-local reference is missing or out of order: $fx',
        });
    });

    it('dispatches one admitted commit batch as one compensated command group', async () => {
        const executionOrder: string[] = [];
        registerHandlerMap({
            setTrackGain: {
                execute: () => {
                    executionOrder.push('gain');
                    return { status: 'written' };
                },
                describe: (action) => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: {
                            trackId: action.payload.trackId,
                            gain: action.payload.expectedGain,
                            expectedGain: action.payload.gain,
                        },
                    },
                }),
                undoable: true,
            },
            setTrackPan: {
                execute: () => {
                    executionOrder.push('pan');
                    return { status: 'written' };
                },
                describe: (action) => ({
                    label: 'Set pan',
                    inverseAction: {
                        type: 'setTrackPan',
                        payload: {
                            trackId: action.payload.trackId,
                            pan: action.payload.expectedPan,
                            expectedPan: action.payload.pan,
                        },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectInvariantsValid: true,
            targetFingerprints: {
                'track-drums': 'drums',
                'track-guitar': 'guitar',
                'track-vocal': 'vocal',
            },
        }));
        const input = batch({ mode: 'commit' });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: authority(input),
            confirmed: true,
            serialized: JSON.stringify(input),
        });
        if (result.status === 'rejected') {
            throw new Error(result.reason);
        }

        expect(result).toMatchObject({
            status: 'committed',
            actions: [{ action: { type: 'setTrackGain' } }, { action: { type: 'setTrackPan' } }],
        });
        expect(executionOrder).toEqual(['gain', 'pan']);
    });

    it('requires confirmation when the application did not grant auto-commit', async () => {
        const input = batch({ mode: 'commit' });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: authority(input),
            serialized: JSON.stringify(input),
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Commit batch requires confirmation or the auto-commit grant',
            actions: [],
        });
    });

    it('does not dispatch a preview batch through the live executor', async () => {
        const execute = vi.fn();
        registerHandlerMap({
            setTrackGain: { execute, describe: () => ({ label: 'Set gain', inverseAction: null }), undoable: false },
            setTrackPan: { execute, describe: () => ({ label: 'Set pan', inverseAction: null }), undoable: false },
        });

        const input = batch();
        const result = await executeVersionedCommandBatchEnvelope({
            authority: authority(input),
            serialized: JSON.stringify(input),
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Preview batches require the isolated preview executor',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });
});
