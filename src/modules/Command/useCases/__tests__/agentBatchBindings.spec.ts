import { afterEach, describe, expect, it } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { type AppAction } from '#/utils/handlerContract';

import {
    type CommandBatchLocalBinding,
    type VersionedCommandBatchEnvelope,
} from '../../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../../models/VersionedCommandEnvelope';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectDivergencePort } from '../commandProjectDivergencePort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { commandTrackDefaultsPort } from '../commandTrackDefaultsPort';
import { compilePartialCommandBatchAcceptance } from '../compilePartialCommandBatchAcceptance';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { createVerifiedBatchReceipt } from '../createVerifiedBatchReceipt';
import { materializeCommandApplicationIds } from '../materializeCommandApplicationIds';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { partialCommandBatchSelection } from '../partialCommandBatchSelection';
import { refreshVersionedCommandBatchForApproval } from '../refreshVersionedCommandBatchForApproval';
import { resolveVersionedCommandBatchBindings } from '../resolveVersionedCommandBatchBindings';
import { serializeVersionedCommandBatchEnvelope } from '../serializeVersionedCommandBatchEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

const TRACK_ID = 'track-ai-11111111-1111-4111-8111-111111111111';
const CLIP_ID = 'clip-ai-22222222-2222-4222-8222-222222222222';
const REVISION = 'revision-1';

const trackAction: AppAction = { type: 'addTrack', payload: { name: 'Piano', kind: 'midi', id: TRACK_ID } };
const clipAction: AppAction = {
    type: 'addClip',
    payload: { trackId: '$piano', startBeat: 0, endBeat: 4, name: 'Melody', id: CLIP_ID },
};
const notesAction: AppAction = {
    type: 'addNotes',
    payload: { clipId: '$melody', notes: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
};

function envelopeFor(action: AppAction, dependencyIds: readonly string[] = []): VersionedCommandEnvelope {
    return createExecutionCommandEnvelope({
        action,
        dependencyIds,
        expectedEffect: `Execute ${action.type}`,
        normalizedProjectRevision: REVISION,
    }).envelope;
}

function compile(input: {
    bindings: readonly CommandBatchLocalBinding[];
    commands: readonly VersionedCommandEnvelope[];
    mode?: 'commit' | 'preview';
}) {
    return compileVersionedCommandBatchEnvelope({
        baseRevision: REVISION,
        batchId: 'batch-creation',
        batchLocalBindings: input.bindings,
        commands: input.commands.map(serializeVersionedCommandEnvelope),
        intent: 'Add a midi track named Piano, a clip named Melody on it, and notes in that clip',
        mode: input.mode ?? 'preview',
        projectId: 'project-1',
        runId: 'run-creation',
    });
}

/** The provider plan: create a track, a clip on that plan-local track, then notes in that plan-local clip. */
function creationBatch(mode?: 'commit' | 'preview') {
    commandTrackDefaultsPort.setTrackColorProvider(() => '#123456');
    registerCreationHandlers();
    const track = envelopeFor(trackAction);
    const clip = envelopeFor(clipAction, [track.commandId]);
    const notes = envelopeFor(notesAction, [clip.commandId]);
    const bindings: readonly CommandBatchLocalBinding[] = [
        { bindingId: '$piano', producerArgument: 'id', producerCommandId: track.commandId },
        { bindingId: '$melody', producerArgument: 'id', producerCommandId: clip.commandId },
    ];
    const compiled = compile({ bindings, commands: [track, clip, notes], mode });
    const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return { authority: compiled.authority, bindings, clip, envelope: parsed.envelope, notes, track };
}

function reparse(envelope: VersionedCommandBatchEnvelope) {
    return parseVersionedCommandBatchEnvelope(serializeVersionedCommandBatchEnvelope(envelope));
}

function commandIndex(envelope: VersionedCommandBatchEnvelope, commandId: string): number {
    return envelope.commands.findIndex((command) => command.commandId === commandId);
}

function batchLocalReferenceIds(commands: readonly VersionedCommandEnvelope[]): readonly string[] {
    return commands.flatMap((command) =>
        command.objectReferences.flatMap((reference) => (reference.scope === 'batch-local' ? [reference.id] : []))
    );
}

const creationHandler = {
    canReapplyAfterDivergence: () => true,
    describe: () => ({ label: 'Create' }),
    execute: () => ({ status: 'written' as const }),
    undoable: true,
    validate: () => true,
};

function hasStringId(note: unknown): boolean {
    return typeof note === 'object' && note !== null && 'id' in note && typeof note.id === 'string';
}

/** Stands in for the MIDI owner's check that every note carries an application-minted identity. */
function hasMaterializedNoteIds(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || !('notes' in value)) {
        return false;
    }
    return Array.isArray(value.notes) && value.notes.every(hasStringId);
}

/** `addNotes` delegates its serialized-boundary shape check to its owning handler, so the batch needs one. */
function registerCreationHandlers(): void {
    registerHandlerMap({
        addTrack: creationHandler,
        addClip: creationHandler,
        addNotes: { ...creationHandler, validateMaterializedCommandArguments: hasMaterializedNoteIds },
    });
}

describe('agent batch bindings', () => {
    afterEach(() => {
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandProjectDivergencePort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        commandTrackDefaultsPort.setTrackColorProvider(null);
    });

    it('replaces every plan-local reference with its producer assigned ID and is idempotent', () => {
        const { envelope } = creationBatch();

        const resolved = resolveVersionedCommandBatchBindings(envelope);

        expect(resolved.map((command) => command.arguments)).toMatchObject([
            { id: TRACK_ID },
            { id: CLIP_ID, trackId: TRACK_ID },
            { clipId: CLIP_ID },
        ]);
        expect(batchLocalReferenceIds(resolved)).toEqual([]);

        const resolvedAgain = resolveVersionedCommandBatchBindings({ ...envelope, commands: resolved });
        expect(resolvedAgain).toEqual(resolved);
    });

    it.each([
        { action: trackAction, argument: 'id', name: 'addTrack', supplied: TRACK_ID },
        { action: clipAction, argument: 'id', name: 'addClip', supplied: CLIP_ID },
    ])('records the pre-supplied $name identity without minting a fresh one', ({ action, argument, supplied }) => {
        commandTrackDefaultsPort.setTrackColorProvider(() => '#123456');

        const materialized = materializeCommandApplicationIds(action);

        expect(materialized.applicationAssignedIds).toContainEqual({ argument, value: supplied });
    });

    it.each([
        { name: 'addTrack', prefix: 'track-command-' },
        { name: 'addClip', prefix: 'clip-command-' },
    ])('mints a $prefix identity only when the $name command supplies none', ({ name, prefix }) => {
        commandTrackDefaultsPort.setTrackColorProvider(() => '#123456');
        const action: AppAction =
            name === 'addTrack'
                ? { type: 'addTrack', payload: { name: 'Piano', kind: 'midi' } }
                : { type: 'addClip', payload: { trackId: '$piano', startBeat: 0, endBeat: 4, name: 'Melody' } };

        const materialized = materializeCommandApplicationIds(action);

        expect(materialized.applicationAssignedIds).toContainEqual({
            argument: 'id',
            value: expect.stringMatching(new RegExp(`^${prefix}[\\da-f-]{36}$`, 'u')),
        });
    });

    it('orders every consumer after the producer it binds', () => {
        const { clip, envelope, notes, track } = creationBatch();

        expect(envelope.commands.map((command) => command.operation)).toEqual(['addTrack', 'addClip', 'addNotes']);
        for (const binding of envelope.batchLocalBindings) {
            const producerIndex = commandIndex(envelope, binding.producerCommandId);
            const consumers = envelope.commands.filter((command) =>
                command.objectReferences.some(
                    (reference) => reference.scope === 'batch-local' && reference.id === binding.bindingId
                )
            );
            expect(consumers).not.toEqual([]);
            for (const consumer of consumers) {
                expect(commandIndex(envelope, consumer.commandId)).toBeGreaterThan(producerIndex);
            }
        }
        expect(envelope.dependencies).toEqual([
            { commandId: clip.commandId, dependsOn: [track.commandId] },
            { commandId: notes.commandId, dependsOn: [clip.commandId] },
        ]);
    });

    it.each([
        {
            name: 'a binding whose producer is placed after its consumer',
            reason: 'Batch dependencies are missing or out of order for ',
            tamper: (envelope: VersionedCommandBatchEnvelope) => ({
                ...envelope,
                commands: [envelope.commands[1]!, envelope.commands[0]!, envelope.commands[2]!],
            }),
        },
        {
            name: 'dependency IDs that form a cycle',
            reason: 'Batch dependencies are missing or out of order for ',
            tamper: (envelope: VersionedCommandBatchEnvelope) => ({
                ...envelope,
                commands: [
                    { ...envelope.commands[0]!, dependencyIds: [envelope.commands[1]!.commandId] },
                    envelope.commands[1]!,
                    envelope.commands[2]!,
                ],
                dependencies: [
                    { commandId: envelope.commands[0]!.commandId, dependsOn: [envelope.commands[1]!.commandId] },
                    ...envelope.dependencies,
                ],
            }),
        },
    ])('refuses $name', ({ reason, tamper }) => {
        const { envelope } = creationBatch();

        expect(reparse(tamper(envelope))).toMatchObject({
            status: 'invalid',
            reason: expect.stringContaining(reason),
        });
    });

    it('force-includes both producers when partial acceptance selects only the notes command', () => {
        const { envelope, notes } = creationBatch();
        const previewSelection = partialCommandBatchSelection.create(
            envelope,
            envelope.commands.map((command) => command.commandId)
        );

        const partial = compilePartialCommandBatchAcceptance({
            batchId: 'batch-partial',
            previewSelection,
            runId: 'run-partial',
            selectedIntentGroupIds: [notes.commandId],
        });

        if (partial.status !== 'compiled') {
            throw new Error(partial.reason);
        }
        expect(partial.includedOriginalCommandIds).toEqual(envelope.commands.map((command) => command.commandId));
        const accepted = parseVersionedCommandBatchEnvelope(partial.serialized, partial.authority);
        if (accepted.status === 'invalid') {
            throw new Error(accepted.reason);
        }
        expect(accepted.envelope.commands.map((command) => command.commandId)).not.toEqual(
            envelope.commands.map((command) => command.commandId)
        );
        expect(
            accepted.envelope.batchLocalBindings.map((binding) => ({
                bindingId: binding.bindingId,
                producerIndex: commandIndex(accepted.envelope, binding.producerCommandId),
            }))
        ).toEqual([
            { bindingId: '$piano', producerIndex: 0 },
            { bindingId: '$melody', producerIndex: 1 },
        ]);

        const resolved = resolveVersionedCommandBatchBindings(accepted.envelope);
        expect(batchLocalReferenceIds(resolved)).toEqual([]);
        expect(resolved.map((command) => command.arguments)).toMatchObject([
            { id: TRACK_ID },
            { id: CLIP_ID, trackId: TRACK_ID },
            { clipId: CLIP_ID },
        ]);
    });

    it('keeps the same creation identities when the batch is refreshed for approval', () => {
        commandProjectRevisionPort.setProvider(() => REVISION);
        commandProjectDivergencePort.setProvider(({ commandsCompatible, targetIds }) => ({
            kind: 'compatible-same-object',
            mayReapply: commandsCompatible,
            repairCandidates: [],
            targetIds,
        }));
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-1',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        const { authority, envelope } = creationBatch('commit');
        const compiled = compile({
            bindings: envelope.batchLocalBindings,
            commands: envelope.commands,
            mode: 'commit',
        });

        const refreshed = refreshVersionedCommandBatchForApproval({
            authority: compiled.authority,
            serialized: compiled.serialized,
        });

        expect(authority).not.toBe(compiled.authority);
        if (refreshed.status !== 'ready') {
            throw new Error(refreshed.reason);
        }
        const approved = parseVersionedCommandBatchEnvelope(
            refreshed.commandBatch.serialized,
            refreshed.commandBatch.authority
        );
        if (approved.status === 'invalid') {
            throw new Error(approved.reason);
        }
        expect(
            resolveVersionedCommandBatchBindings(approved.envelope).map((command) => command.arguments)
        ).toMatchObject([{ id: TRACK_ID }, { id: CLIP_ID, trackId: TRACK_ID }, { clipId: CLIP_ID }]);
    });

    it('reports each plan-local binding name against the identity its producer assigned', () => {
        const { envelope } = creationBatch('commit');

        const receipt = createVerifiedBatchReceipt({
            contentHash: 'content-hash',
            envelope,
            observedBaseRevision: REVISION,
            resultingRevision: REVISION,
            result: {
                status: 'committed',
                actions: envelope.commands.map((command) => ({
                    action: { type: command.operation, payload: command.arguments } as AppAction,
                    receipt: {
                        commandId: command.commandId,
                        schemaVersion: 1 as const,
                        applicationAssigned: { ids: [], timestamps: [] },
                    },
                })),
            },
        });

        expect(
            receipt.createdBindings
                .flatMap((binding) =>
                    typeof binding.bindingId === 'string'
                        ? [{ bindingId: binding.bindingId, value: binding.value }]
                        : []
                )
                .toSorted((left, right) => left.bindingId.localeCompare(right.bindingId))
        ).toEqual([
            { bindingId: '$melody', value: CLIP_ID },
            { bindingId: '$piano', value: TRACK_ID },
        ]);
    });
});
