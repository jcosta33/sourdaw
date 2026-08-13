import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { buildSemanticProjectDiff } from '../buildSemanticProjectDiff';
import { compilePartialCommandBatchAcceptance } from '../compilePartialCommandBatchAcceptance';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
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
    return { ...compiled, envelope: parsed.envelope };
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
            authority: preview.authority,
            batchId: 'batch-partial',
            runId: 'run-partial',
            selectedIntentGroupIds: [GAIN_COMMAND_ID],
            serialized: preview.serialized,
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

        const partial = compilePartialCommandBatchAcceptance({
            authority: compiled.authority,
            batchId: 'batch-binding-partial',
            runId: 'run-binding-partial',
            selectedIntentGroupIds: [SEND_COMMAND_ID],
            serialized: compiled.serialized,
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

    it('rejects empty or unknown partial selections without producing authority', () => {
        const preview = previewBatch();

        expect(
            compilePartialCommandBatchAcceptance({
                authority: preview.authority,
                batchId: 'batch-empty',
                runId: 'run-empty',
                selectedIntentGroupIds: [],
                serialized: preview.serialized,
            })
        ).toEqual({ status: 'rejected', reason: 'Partial acceptance requires at least one intent group' });
        expect(
            compilePartialCommandBatchAcceptance({
                authority: preview.authority,
                batchId: 'batch-unknown',
                runId: 'run-unknown',
                selectedIntentGroupIds: ['unknown'],
                serialized: preview.serialized,
            })
        ).toEqual({ status: 'rejected', reason: 'Unknown intent group: unknown' });
        expect(
            compilePartialCommandBatchAcceptance({
                authority: preview.authority,
                batchId: 'batch-not-preview',
                runId: 'run-not-preview',
                selectedIntentGroupIds: [GAIN_COMMAND_ID],
                serialized: JSON.stringify({ ...preview.envelope, mode: 'commit' }),
            })
        ).toEqual({ status: 'rejected', reason: 'Partial acceptance requires a preview batch' });
    });
});
