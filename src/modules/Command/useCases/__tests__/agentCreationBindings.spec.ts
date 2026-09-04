import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { type AppAction } from '#/utils/handlerContract';

import { type VersionedCommandBatchEnvelope } from '../../models/VersionedCommandBatchEnvelope';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandTrackDefaultsPort } from '../commandTrackDefaultsPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { resolveVersionedCommandBatchBindings } from '../resolveVersionedCommandBatchBindings';
import { serializeVersionedCommandBatchEnvelope } from '../serializeVersionedCommandBatchEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

import { executeApprovedVersionedCommandBatchEnvelope } from './commandApprovalTestFixture';

const TRACK_ID = 'track-ai-11111111-1111-4111-8111-111111111111';
const CLIP_ID = 'clip-ai-22222222-2222-4222-8222-222222222222';

function envelopeFor(action: AppAction, dependencyIds: readonly string[] = []) {
    return createExecutionCommandEnvelope({
        action,
        dependencyIds,
        expectedEffect: `Execute ${action.type}`,
        normalizedProjectRevision: 'revision-1',
    }).envelope;
}

/** The plan the provider writes: create a track, then a clip on that same plan-local track. */
function creationBatch() {
    commandTrackDefaultsPort.setTrackColorProvider(() => '#123456');
    const track = envelopeFor({ type: 'addTrack', payload: { name: 'Piano', kind: 'midi', id: TRACK_ID } });
    const clip = envelopeFor(
        {
            type: 'addClip',
            payload: { trackId: '$piano', startBeat: 0, endBeat: 4, name: 'Melody', id: CLIP_ID },
        },
        [track.commandId]
    );
    const compiled = compileVersionedCommandBatchEnvelope({
        runId: 'run-creation',
        batchId: 'batch-creation',
        projectId: 'project-1',
        baseRevision: 'revision-1',
        intent: 'Add a midi track named Piano and a clip named Melody on it',
        mode: 'preview',
        commands: [serializeVersionedCommandEnvelope(track), serializeVersionedCommandEnvelope(clip)],
        batchLocalBindings: [{ bindingId: '$piano', producerArgument: 'id', producerCommandId: track.commandId }],
    });
    const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return { authority: compiled.authority, clip, envelope: parsed.envelope, track };
}

function reparse(envelope: VersionedCommandBatchEnvelope) {
    return parseVersionedCommandBatchEnvelope(serializeVersionedCommandBatchEnvelope(envelope));
}

describe('agent creation bindings', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandTrackDefaultsPort.setTrackColorProvider(null);
    });

    it('resolves a plan-local track binding into the clip it creates exactly once', () => {
        const { envelope } = creationBatch();

        const resolved = resolveVersionedCommandBatchBindings(envelope);
        expect(resolved[1]?.arguments).toMatchObject({ trackId: TRACK_ID, name: 'Melody' });
        expect(resolved[1]?.objectReferences).toContainEqual({
            argument: 'trackId',
            id: TRACK_ID,
            scope: 'stable',
        });

        const resolvedAgain = resolveVersionedCommandBatchBindings({ ...envelope, commands: resolved });
        expect(resolvedAgain.map((command) => command.arguments)).toEqual(resolved.map((command) => command.arguments));
    });

    it('orders the created clip after the track it depends on', () => {
        const { envelope, track } = creationBatch();

        expect(envelope.commands.map((command) => command.operation)).toEqual(['addTrack', 'addClip']);
        expect(envelope.commands[1]?.dependencyIds).toEqual([track.commandId]);
        expect(envelope.dependencies).toEqual([
            { commandId: envelope.commands[1]?.commandId, dependsOn: [track.commandId] },
        ]);
    });

    it.each([
        {
            name: 'a consumer that declares no dependency on its producer',
            reason: 'Batch-local reference is missing or out of order: $piano',
            tamper: (envelope: VersionedCommandBatchEnvelope) => ({
                ...envelope,
                commands: [envelope.commands[0]!, { ...envelope.commands[1]!, dependencyIds: [] }],
                dependencies: [],
            }),
        },
        {
            name: 'a consumer placed before its producer',
            reason: 'Batch dependencies are missing or out of order for ',
            tamper: (envelope: VersionedCommandBatchEnvelope) => ({
                ...envelope,
                commands: [envelope.commands[1]!, envelope.commands[0]!],
            }),
        },
        {
            name: 'a reference with no declared producer',
            reason: 'Batch-local reference is missing or out of order: $piano',
            tamper: (envelope: VersionedCommandBatchEnvelope) => ({ ...envelope, batchLocalBindings: [] }),
        },
        {
            name: 'two producers claiming one binding name',
            reason: 'Batch-local binding IDs must be unique',
            tamper: (envelope: VersionedCommandBatchEnvelope) => ({
                ...envelope,
                batchLocalBindings: [envelope.batchLocalBindings[0]!, envelope.batchLocalBindings[0]!],
            }),
        },
        {
            name: 'a producer argument the producing command never assigns',
            reason: 'Batch-local binding producer is invalid: $piano',
            tamper: (envelope: VersionedCommandBatchEnvelope) => ({
                ...envelope,
                batchLocalBindings: [{ ...envelope.batchLocalBindings[0]!, producerArgument: 'busId' }],
            }),
        },
    ])('refuses $name', ({ reason, tamper }) => {
        const { envelope } = creationBatch();

        expect(reparse(tamper(envelope))).toMatchObject({
            status: 'invalid',
            reason: expect.stringContaining(reason),
        });
    });

    it('refuses an invented creation identity before any handler runs', async () => {
        const executed: string[] = [];
        const creationHandler = {
            describe: () => ({ label: 'Create' }),
            execute: (action: AppAction) => {
                executed.push(action.type);
                return { status: 'written' as const };
            },
            previewExecution: 'isolated-project' as const,
            undoable: true,
            validate: () => true,
        };
        registerHandlerMap({ addTrack: creationHandler, addClip: creationHandler });

        const { authority, envelope } = creationBatch();
        const invented = {
            ...envelope,
            batchLocalBindings: [{ ...envelope.batchLocalBindings[0]!, bindingId: '$ghost' }],
        };

        const result = await executeApprovedVersionedCommandBatchEnvelope({
            authority,
            serialized: serializeVersionedCommandBatchEnvelope(invented),
        });

        expect(result.status).toBe('rejected');
        expect(executed).toEqual([]);
    });
});
