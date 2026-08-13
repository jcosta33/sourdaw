import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { buildSemanticProjectDiff } from '../buildSemanticProjectDiff';
import { compilePartialCommandBatchAcceptance } from '../compilePartialCommandBatchAcceptance';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { partialCommandBatchSelection } from '../partialCommandBatchSelection';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

const TEMPO_COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const GAIN_COMMAND_ID = '22222222-2222-4222-8222-222222222222';
const SECTION_COMMAND_ID = '33333333-3333-4333-8333-333333333333';
const REMOVE_MARKER_COMMAND_ID = '44444444-4444-4444-8444-444444444444';
const BUS_COMMAND_ID = '55555555-5555-4555-8555-555555555555';
const SEND_COMMAND_ID = '66666666-6666-4666-8666-666666666666';

function command(input: {
    action: AppAction;
    commandId: string;
    dependencyIds?: readonly string[];
    expectedEffect: string;
}) {
    return {
        ...createExecutionCommandEnvelope({
            action: input.action,
            dependencyIds: input.dependencyIds,
            expectedEffect: input.expectedEffect,
            normalizedProjectRevision: 'revision-1',
            options: { groupId: 'batch-preview' },
        }).envelope,
        commandId: input.commandId,
    };
}

function previewBatch() {
    const commands = [
        command({
            action: { type: 'setTempo', payload: { bpm: 124 } },
            commandId: TEMPO_COMMAND_ID,
            expectedEffect: 'Set the project tempo to 124 BPM.',
        }),
        command({
            action: { type: 'setTrackGain', payload: { trackId: 'track-bass', gain: 0.8, expectedGain: 1 } },
            commandId: GAIN_COMMAND_ID,
            dependencyIds: [TEMPO_COMMAND_ID],
            expectedEffect: 'Lower Bass from unity to 0.8 gain.',
        }),
        {
            ...command({
                action: {
                    type: 'addSection',
                    payload: { sectionId: 'section-chorus', name: 'Chorus', startBeat: 16, endBeat: 32 },
                },
                commandId: SECTION_COMMAND_ID,
                expectedEffect: 'Create the Chorus section from beat 16 to 32.',
            }),
            applicationAssignedIds: [{ argument: 'sectionId', value: 'section-chorus' }],
        },
        command({
            action: { type: 'removeMarker', payload: { markerId: 'marker-guide' } },
            commandId: REMOVE_MARKER_COMMAND_ID,
            expectedEffect: 'Delete the obsolete guide marker.',
        }),
    ];
    const compiled = compileVersionedCommandBatchEnvelope({
        baseRevision: 'revision-1',
        batchId: 'batch-preview',
        commands: commands.map(serializeVersionedCommandEnvelope),
        dynamicEffects: {
            affectedTrackIds: [],
            affectedClipIds: [],
            affectedTargetIds: [],
            automationPoints: 0,
            deletedObjects: 0,
        },
        intent: 'Prepare the mix and clean its structure.',
        mode: 'preview',
        projectId: 'project-1',
        protectedTargetIds: ['track-lead-vocal'],
        runId: 'run-preview',
    });
    const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return {
        ...compiled,
        envelope: parsed.envelope,
        previewSelection: partialCommandBatchSelection.create(
            parsed.envelope,
            parsed.envelope.commands.map((entry) => entry.commandId)
        ),
    };
}

describe('semantic project diff', () => {
    it('returns a versioned semantic diff with exact groups, consequences, protections, and audio impact', () => {
        const { envelope } = previewBatch();

        const diff = buildSemanticProjectDiff({
            envelope,
            recoveryByCommandId: { [REMOVE_MARKER_COMMAND_ID]: 'inverse' },
        });

        expect(diff).toMatchObject({
            schemaVersion: 1,
            baseRevision: 'revision-1',
            batchId: 'batch-preview',
            summary: 'Prepare the mix and clean its structure.',
            affectedTrackIds: ['track-bass'],
            affectedTimeRanges: [{ startBeat: 16, endBeat: 32 }],
            estimatedAudioImpact: { level: 'structural' },
        });
        expect(diff.intentGroups.map((group) => ({ id: group.id, commandIds: group.commandIds }))).toEqual([
            { id: TEMPO_COMMAND_ID, commandIds: [TEMPO_COMMAND_ID] },
            { id: GAIN_COMMAND_ID, commandIds: [GAIN_COMMAND_ID] },
            { id: SECTION_COMMAND_ID, commandIds: [SECTION_COMMAND_ID] },
            { id: REMOVE_MARKER_COMMAND_ID, commandIds: [REMOVE_MARKER_COMMAND_ID] },
        ]);
        expect(diff.destructiveChanges).toEqual([
            {
                classification: 'deletion',
                commandIds: [REMOVE_MARKER_COMMAND_ID],
                consequence: 'Delete the obsolete guide marker.',
                groupId: REMOVE_MARKER_COMMAND_ID,
                objectIds: ['marker-guide'],
                recovery: 'inverse',
            },
        ]);
        expect(diff.facts.created).toEqual([
            expect.objectContaining({ commandId: SECTION_COMMAND_ID, objectIds: ['section-chorus'] }),
        ]);
        expect(diff.facts.edited).toContainEqual(
            expect.objectContaining({ commandId: GAIN_COMMAND_ID, objectIds: ['track-bass'] })
        );
        expect(diff.facts.project).toEqual([expect.objectContaining({ commandId: TEMPO_COMMAND_ID, objectIds: [] })]);
        expect(diff.facts.protectedUnchanged).toEqual([
            {
                commandId: null,
                groupId: 'protected-unchanged',
                objectIds: ['track-lead-vocal'],
                summary: 'Protected object remains unchanged: track-lead-vocal',
            },
        ]);
        expect(diff.facts.moved).toEqual([]);
        expect(diff.facts.renamed).toEqual([]);
        expect(diff.facts.routed).toEqual([]);
        expect(diff.facts.automated).toEqual([]);
        expect(diff.facts.asset).toEqual([]);
        expect(diff.warnings).toContain('1 destructive change requires explicit acceptance.');
    });

    it('compiles a selected intent group and its prerequisites into a new valid batch without mutating the preview', () => {
        const preview = previewBatch();
        const originalSerialized = preview.serialized;

        const partial = compilePartialCommandBatchAcceptance({
            batchId: 'batch-partial',
            previewSelection: preview.previewSelection,
            runId: 'run-partial',
            selectedIntentGroupIds: [GAIN_COMMAND_ID],
        });

        expect(partial.status).toBe('compiled');
        if (partial.status !== 'compiled') {
            throw new Error(partial.reason);
        }
        const parsed = parseVersionedCommandBatchEnvelope(partial.serialized, partial.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        expect(parsed.envelope).toMatchObject({
            batchId: 'batch-partial',
            runId: 'run-partial',
            mode: 'commit',
            grants: { autoCommit: false },
            scope: {
                targetIds: ['track-bass'],
                protectedTargetIds: ['track-lead-vocal'],
            },
        });
        expect(parsed.envelope.commands.map((entry) => entry.groupId)).toEqual(['batch-partial', 'batch-partial']);
        expect(parsed.envelope.commands.map((entry) => entry.commandId)).not.toContain(TEMPO_COMMAND_ID);
        expect(parsed.envelope.commands.map((entry) => entry.commandId)).not.toContain(GAIN_COMMAND_ID);
        expect(parsed.envelope.dependencies).toEqual([
            {
                commandId: parsed.envelope.commands[1]?.commandId,
                dependsOn: [parsed.envelope.commands[0]?.commandId],
            },
        ]);
        expect(partial.includedIntentGroupIds).toEqual([TEMPO_COMMAND_ID, GAIN_COMMAND_ID]);
        expect(partial.includedOriginalCommandIds).toEqual([TEMPO_COMMAND_ID, GAIN_COMMAND_ID]);
        expect(preview.serialized).toBe(originalSerialized);
        expect(preview.envelope.commands).toHaveLength(4);
    });

    it('retains a batch-local producer required by a selected consumer and remaps the dependency identity', () => {
        const producer = {
            ...command({
                action: {
                    type: 'createBus',
                    payload: {
                        name: '$fx',
                        busId: 'bus-real',
                        color: '#123456',
                        initialAlternativeId: 'alternative-real',
                    },
                },
                commandId: BUS_COMMAND_ID,
                expectedEffect: 'Create the shared FX bus.',
            }),
            groupId: 'batch-binding-preview',
            applicationAssignedIds: [
                { argument: 'busId', value: 'bus-real' },
                { argument: 'initialAlternativeId', value: 'alternative-real' },
            ],
        };
        const consumer = {
            ...command({
                action: {
                    type: 'addSend',
                    payload: { trackId: 'track-vocal', busId: '$fx', level: 0.5, preFader: false },
                },
                commandId: SEND_COMMAND_ID,
                dependencyIds: [BUS_COMMAND_ID],
                expectedEffect: 'Route the vocal to the shared FX bus.',
            }),
            groupId: 'batch-binding-preview',
            objectReferences: [
                { argument: 'trackId', id: 'track-vocal', scope: 'stable' as const },
                { argument: 'busId', id: '$fx', scope: 'batch-local' as const },
            ],
        };
        const compiled = compileVersionedCommandBatchEnvelope({
            baseRevision: 'revision-1',
            batchId: 'batch-binding-preview',
            batchLocalBindings: [{ bindingId: '$fx', producerArgument: 'busId', producerCommandId: BUS_COMMAND_ID }],
            commands: [producer, consumer].map(serializeVersionedCommandEnvelope),
            intent: 'Create a shared FX route.',
            mode: 'preview',
            projectId: 'project-1',
            runId: 'run-binding-preview',
        });
        const parsedPreview = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
        if (parsedPreview.status === 'invalid') {
            throw new Error(parsedPreview.reason);
        }
        const partial = compilePartialCommandBatchAcceptance({
            batchId: 'batch-binding-partial',
            previewSelection: partialCommandBatchSelection.create(parsedPreview.envelope, [
                BUS_COMMAND_ID,
                SEND_COMMAND_ID,
            ]),
            runId: 'run-binding-partial',
            selectedIntentGroupIds: [SEND_COMMAND_ID],
        });

        expect(partial.status).toBe('compiled');
        if (partial.status !== 'compiled') {
            throw new Error(partial.reason);
        }
        const parsed = parseVersionedCommandBatchEnvelope(partial.serialized, partial.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        const [remappedProducer, remappedConsumer] = parsed.envelope.commands;
        expect(partial.includedOriginalCommandIds).toEqual([BUS_COMMAND_ID, SEND_COMMAND_ID]);
        expect(remappedConsumer?.dependencyIds).toEqual([remappedProducer?.commandId]);
        expect(parsed.envelope.batchLocalBindings).toEqual([
            {
                bindingId: '$fx',
                producerArgument: 'busId',
                producerCommandId: remappedProducer?.commandId,
            },
        ]);
        expect(remappedConsumer?.objectReferences).toContainEqual({
            argument: 'busId',
            id: '$fx',
            scope: 'batch-local',
        });
    });

    it('preserves exact application-owned dynamic targets and budgets for a selected dynamic group', () => {
        const clearCommand = command({
            action: { type: 'clearSolos' },
            commandId: '77777777-7777-4777-8777-777777777777',
            expectedEffect: 'Clear solos from the two currently soloed tracks.',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            baseRevision: 'revision-1',
            batchId: 'batch-dynamic-preview',
            commands: [{ ...clearCommand, groupId: 'batch-dynamic-preview' }].map(serializeVersionedCommandEnvelope),
            dynamicEffects: { affectedTrackIds: ['track-solo-a', 'track-solo-b'] },
            intent: 'Clear solos.',
            mode: 'preview',
            projectId: 'project-1',
            runId: 'run-dynamic-preview',
        });
        const parsedPreview = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
        if (parsedPreview.status === 'invalid') {
            throw new Error(parsedPreview.reason);
        }
        const diff = buildSemanticProjectDiff({ envelope: parsedPreview.envelope });
        expect(diff.affectedTrackIds).toEqual(['track-solo-a', 'track-solo-b']);
        expect(diff.intentGroups[0]?.affectedTrackIds).toEqual(['track-solo-a', 'track-solo-b']);

        const partial = compilePartialCommandBatchAcceptance({
            batchId: 'batch-dynamic-partial',
            previewSelection: partialCommandBatchSelection.create(parsedPreview.envelope, [clearCommand.commandId]),
            runId: 'run-dynamic-partial',
            selectedIntentGroupIds: [clearCommand.commandId],
        });

        expect(partial.status).toBe('compiled');
        if (partial.status !== 'compiled') {
            throw new Error(partial.reason);
        }
        const parsed = parseVersionedCommandBatchEnvelope(partial.serialized, partial.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        expect(parsed.envelope.scope.targetIds).toEqual(['track-solo-a', 'track-solo-b']);
        expect(parsed.envelope.dynamicEffects).toEqual({
            affectedTrackIds: ['track-solo-a', 'track-solo-b'],
        });
        expect(parsed.envelope.budgets.maxAffectedTracks).toBe(2);
    });

    it('rejects a dynamic-effects subset when the preview carries only aggregate ownership', () => {
        const gainCommand = command({
            action: { type: 'setTrackGain', payload: { trackId: 'track-main', gain: 0.8, expectedGain: 1 } },
            commandId: '88888888-8888-4888-8888-888888888881',
            expectedEffect: 'Lower the main track.',
        });
        const renameCommand = command({
            action: { type: 'renameTrack', payload: { trackId: 'track-other', name: 'Other' } },
            commandId: '88888888-8888-4888-8888-888888888882',
            expectedEffect: 'Rename the other track.',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            baseRevision: 'revision-1',
            batchId: 'batch-aggregate-preview',
            commands: [
                { ...gainCommand, groupId: 'batch-aggregate-preview' },
                { ...renameCommand, groupId: 'batch-aggregate-preview' },
            ].map(serializeVersionedCommandEnvelope),
            dynamicEffects: { affectedTargetIds: ['track-collateral'] },
            intent: 'Edit two tracks with collateral effects.',
            mode: 'preview',
            projectId: 'project-1',
            runId: 'run-aggregate-preview',
        });
        const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }

        expect(
            compilePartialCommandBatchAcceptance({
                batchId: 'batch-aggregate-partial',
                previewSelection: partialCommandBatchSelection.create(parsed.envelope, [
                    gainCommand.commandId,
                    renameCommand.commandId,
                ]),
                runId: 'run-aggregate-partial',
                selectedIntentGroupIds: [gainCommand.commandId],
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Partial acceptance cannot partition aggregate dynamic effects across intent groups',
        });
    });

    it('classifies every governed destructive consequence with exact command, group, and object identity', () => {
        const preview = previewBatch();
        const destructiveCommands = [
            command({
                action: { type: 'removeMarker', payload: { markerId: 'marker-delete' } },
                commandId: '50000000-0000-4000-8000-000000000001',
                expectedEffect: 'Delete one marker.',
            }),
            command({
                action: { type: 'bounceInPlace', payload: { trackId: 'track-replace' } },
                commandId: '50000000-0000-4000-8000-000000000002',
                expectedEffect: 'Replace the track with its bounce.',
            }),
            command({
                action: { type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } },
                commandId: '50000000-0000-4000-8000-000000000003',
                expectedEffect: 'Consolidate two clips.',
            }),
            command({
                action: { type: 'commitScratchPad' },
                commandId: '50000000-0000-4000-8000-000000000004',
                expectedEffect: 'Overwrite the arrangement with the scratch pad.',
            }),
            command({
                action: { type: 'normalizeClip', payload: { clipId: 'clip-source', mode: 'peak' } },
                commandId: '50000000-0000-4000-8000-000000000005',
                expectedEffect: 'Mutate the source clip gain.',
            }),
            command({
                action: { type: 'renderProjectSections', payload: { sectionIds: ['section-render'] } },
                commandId: '50000000-0000-4000-8000-000000000006',
                expectedEffect: 'Render one external section artifact.',
            }),
        ];

        const diff = buildSemanticProjectDiff({
            envelope: { ...preview.envelope, commands: destructiveCommands },
            recoveryByCommandId: Object.fromEntries(
                destructiveCommands.map((entry, index) => [
                    entry.commandId,
                    index === destructiveCommands.length - 1 ? 'compensable' : 'inverse',
                ])
            ),
        });

        expect(diff.destructiveChanges.map((change) => change.classification)).toEqual([
            'deletion',
            'replacement',
            'consolidation',
            'overwrite',
            'source-mutation',
            'irreversible-external-effect',
        ]);
        expect(
            diff.destructiveChanges.map(({ commandIds, groupId, objectIds, consequence, recovery }) => ({
                commandIds,
                groupId,
                objectIds,
                consequence,
                recovery,
            }))
        ).toEqual(
            destructiveCommands.map((entry, index) => ({
                commandIds: [entry.commandId],
                groupId: entry.commandId,
                objectIds: entry.objectReferences.map((reference) => reference.id),
                consequence: entry.expectedEffect,
                recovery: index === destructiveCommands.length - 1 ? 'compensable' : 'inverse',
            }))
        );
    });

    it('classifies destructive command families without relying on an incomplete per-command removal list', () => {
        const preview = previewBatch();
        const commands = [
            command({
                action: { type: 'deleteTime', payload: { startBeat: 8, endBeat: 16 } },
                commandId: '90000000-0000-4000-8000-000000000001',
                expectedEffect: 'Delete eight beats from the timeline.',
            }),
            command({
                action: { type: 'removeAllTracks' },
                commandId: '90000000-0000-4000-8000-000000000002',
                expectedEffect: 'Remove every track.',
            }),
            command({
                action: { type: 'removeAdjustmentLayer', payload: { layerId: 'layer-1' } },
                commandId: '90000000-0000-4000-8000-000000000003',
                expectedEffect: 'Remove one adjustment layer.',
            }),
            command({
                action: {
                    type: 'removeTrackGainAutomationRange',
                    payload: {
                        trackIds: ['track-1'],
                        sectionName: 'Verse',
                        gainDb: -3,
                        sectionId: 'section-verse',
                        startBeat: 8,
                        endBeat: 16,
                        expectedTracks: [
                            {
                                trackId: 'track-1',
                                trackName: 'Track 1',
                                gain: 1,
                                automationMode: 'read',
                                frozen: false,
                            },
                        ],
                        expectedSection: { name: 'Verse', startBeat: 8, endBeat: 16 },
                    },
                },
                commandId: '90000000-0000-4000-8000-000000000004',
                expectedEffect: 'Remove one track-gain automation range.',
            }),
            command({
                action: { type: 'clearChordTrack' },
                commandId: '90000000-0000-4000-8000-000000000005',
                expectedEffect: 'Clear the chord track.',
            }),
            command({
                action: { type: 'thinAutomation', payload: { laneId: 'lane-1', tolerance: 0.05 } },
                commandId: '90000000-0000-4000-8000-000000000006',
                expectedEffect: 'Delete redundant automation points.',
            }),
        ];

        const diff = buildSemanticProjectDiff({ envelope: { ...preview.envelope, commands } });

        expect(diff.destructiveChanges.map((change) => change.classification)).toEqual([
            'deletion',
            'deletion',
            'deletion',
            'deletion',
            'overwrite',
            'deletion',
        ]);
        expect(diff.warnings).toContain('6 destructive changes require explicit acceptance.');
    });

    it('rejects empty or unknown partial selections without producing authority', () => {
        const preview = previewBatch();

        expect(
            compilePartialCommandBatchAcceptance({
                batchId: 'batch-empty',
                previewSelection: preview.previewSelection,
                runId: 'run-empty',
                selectedIntentGroupIds: [],
            })
        ).toEqual({ status: 'rejected', reason: 'Partial acceptance requires at least one intent group' });
        expect(
            compilePartialCommandBatchAcceptance({
                batchId: 'batch-unknown',
                previewSelection: preview.previewSelection,
                runId: 'run-unknown',
                selectedIntentGroupIds: ['unknown'],
            })
        ).toEqual({ status: 'rejected', reason: 'Unknown intent group: unknown' });
        expect(
            compilePartialCommandBatchAcceptance({
                batchId: 'batch-forged-preview',
                previewSelection: { kind: 'successful-command-batch-preview' },
                runId: 'run-forged-preview',
                selectedIntentGroupIds: [GAIN_COMMAND_ID],
            })
        ).toEqual({ status: 'rejected', reason: 'Partial acceptance requires a successful preview outcome' });
        expect(
            compilePartialCommandBatchAcceptance({
                batchId: 'batch-hidden-command',
                previewSelection: partialCommandBatchSelection.create(preview.envelope, [GAIN_COMMAND_ID]),
                runId: 'run-hidden-command',
                selectedIntentGroupIds: [REMOVE_MARKER_COMMAND_ID],
            })
        ).toEqual({ status: 'rejected', reason: `Unknown intent group: ${REMOVE_MARKER_COMMAND_ID}` });
    });
});
