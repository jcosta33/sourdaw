import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import {
    VERSIONED_COMMAND_BATCH_SCHEMA_VERSION,
    type CommandBatchAuthority,
    type CommandBatchScope,
    type VersionedCommandBatchEnvelope,
} from '../../models/VersionedCommandBatchEnvelope';
import {
    type CommandApplicationAssignedId,
    type VersionedCommandEnvelope,
} from '../../models/VersionedCommandEnvelope';
import { compileCommandArgumentMetadata } from '../commandArgumentMetadata';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { getVersionedCommandBatchDivergenceTargetIds } from '../getVersionedCommandBatchDivergenceTargetIds';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

/**
 * Builds one serialized command envelope the way an honest compiler would: the
 * assigned-id record must match the arguments exactly and the metadata must be
 * canonical, so the only forgery left is the one under test — an assigned id
 * that collides with another command's existing target.
 */
function commandFor(action: AppAction, applicationAssignedIds: readonly CommandApplicationAssignedId[] = []) {
    const argumentsValue = 'payload' in action ? (action.payload as Record<string, unknown>) : {};
    const metadata = compileCommandArgumentMetadata(argumentsValue, action.type);
    const envelope = createVersionedCommandEnvelope({
        action,
        applicationAssignedIds,
        availableDeviceVersions: {},
        expectedEffect: `Execute ${action.type}`,
        normalizedProjectRevision: 'revision-1',
        objectReferences: metadata.objectReferences,
        parameterUnits: metadata.parameterUnits,
        reason: `Execute ${action.type}`,
        time: metadata.time,
    });
    return JSON.parse(serializeVersionedCommandEnvelope(envelope)) as VersionedCommandEnvelope;
}

function addClipCollision() {
    return commandFor(
        {
            type: 'addClip',
            payload: { trackId: 'track-a', startBeat: 0, endBeat: 4, name: 'Forged', id: 'clip-p' },
        },
        [{ argument: 'id', value: 'clip-p' }]
    );
}

function renameClipTarget() {
    return commandFor({ type: 'renameClip', payload: { clipId: 'clip-p', name: 'Renamed' } });
}

function batchEnvelope(
    commands: readonly VersionedCommandEnvelope[],
    scope: {
        targetIds: readonly string[];
        existingTargetIds?: readonly string[];
        protectedTargetIds?: readonly string[];
    }
) {
    const existingTargetIds = scope.existingTargetIds ?? scope.targetIds;
    const createdTargetIds = scope.targetIds.filter((targetId) => !existingTargetIds.includes(targetId));
    const protectedTargetIds = scope.protectedTargetIds ?? [];
    const preconditions: Array<Record<string, unknown>> = [
        { kind: 'project-revision', value: 'revision-1' },
        { kind: 'ranges-unlocked' },
    ];
    const postconditions: Array<Record<string, unknown>> = [
        { kind: 'project-invariants-valid' },
        { kind: 'audio-graph-valid' },
    ];
    if (existingTargetIds.length > 0) {
        preconditions.push({ kind: 'targets-exist', targetIds: [...existingTargetIds] });
    }
    if (createdTargetIds.length > 0) {
        preconditions.push({ kind: 'targets-absent', targetIds: [...createdTargetIds] });
        postconditions.push({ kind: 'targets-exist', targetIds: [...createdTargetIds] });
    }
    if (protectedTargetIds.length > 0) {
        postconditions.push({ kind: 'targets-unchanged', targetIds: [...protectedTargetIds] });
    }
    return JSON.stringify({
        schemaVersion: 1,
        runId: 'run-1',
        batchId: 'batch-1',
        projectId: 'project-1',
        baseRevision: 'revision-1',
        idempotencyKey: 'idempotency-1',
        intent: 'Forge or prove a created-id collision',
        mode: 'preview',
        scope: {
            targetIds: [...scope.targetIds],
            targetRanges: [{ startBeat: 0, endBeat: 8 }],
            protectedTargetIds: [...protectedTargetIds],
            protectedRanges: [],
        },
        preconditions,
        commands,
        postconditions,
        dependencies: [],
        batchLocalBindings: [],
        grants: {
            allowedOperationPrefixes: ['add', 'rename', 'automate', 'create', 'set'],
            create: true,
            delete: false,
            routing: true,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: false,
        },
        budgets: {
            maxCommands: 4,
            maxCreatedTracks: 4,
            maxDeletedObjects: 0,
            maxAffectedTracks: 4,
            maxAffectedClips: 4,
            maxAutomationPoints: 0,
            maxImportedAssets: 0,
            maxRenderJobs: 0,
        },
    });
}

function authorityOf(serialized: string) {
    const parsed = JSON.parse(serialized) as {
        projectId: string;
        baseRevision: string;
        scope: CommandBatchScope;
        grants: CommandBatchAuthority['grants'];
        budgets: CommandBatchAuthority['budgets'];
    };
    return {
        projectId: parsed.projectId,
        baseRevision: parsed.baseRevision,
        scope: parsed.scope,
        grants: parsed.grants,
        budgets: parsed.budgets,
    };
}

describe('a batch assigned id against other commands existing targets', () => {
    // The issue's repro: one command claims to create clip-p while another edits the
    // existing clip-p the batch protects. Refused whichever authority parses it.
    it('refuses an assigned id that names a protected target of another command', () => {
        const serialized = batchEnvelope([addClipCollision(), renameClipTarget()], {
            targetIds: ['track-a'],
            protectedTargetIds: ['clip-p'],
        });

        expect(parseVersionedCommandBatchEnvelope(serialized)).toMatchObject({
            status: 'invalid',
            reason: expect.stringContaining('protected batch target'),
        });
        expect(parseVersionedCommandBatchEnvelope(serialized, authorityOf(serialized))).toMatchObject({
            status: 'invalid',
            reason: expect.stringContaining('clip-p'),
        });
    });

    // Red while the batch subtracted one batch-wide assigned-id set: the same collision
    // without protection was admitted, and the batch edited an object one command
    // simultaneously claimed to create.
    it('refuses an assigned id that names a target the batch declares to exist', () => {
        const serialized = batchEnvelope([addClipCollision(), renameClipTarget()], {
            targetIds: ['track-a', 'clip-p'],
        });

        expect(parseVersionedCommandBatchEnvelope(serialized)).toMatchObject({
            status: 'invalid',
            reason: expect.stringContaining('clip-p'),
        });
    });

    // Red while the dependent-target exemption read one batch-wide created set: routing an
    // undeclared track through a bus id a LATER command claims to create escaped the scope
    // check, because the exemption never asked whether the creator comes first.
    it('refuses a dependsOn target exempted by an id a later command claims to create', () => {
        const route = commandFor({
            type: 'automateSendRange',
            payload: { trackIds: ['track-ghost'], busId: 'bus-y', sectionName: 'Verse', reductionDb: 3 },
        });
        const createBus = commandFor(
            {
                type: 'createBus',
                payload: { name: 'Bus', busId: 'bus-y', initialAlternativeId: 'alt-bus', color: '#123456' },
            },
            [
                { argument: 'busId', value: 'bus-y' },
                { argument: 'initialAlternativeId', value: 'alt-bus' },
            ]
        );
        const serialized = batchEnvelope([route, createBus], { targetIds: ['bus-y'] });

        expect(parseVersionedCommandBatchEnvelope(serialized)).toMatchObject({
            status: 'invalid',
            reason: expect.stringContaining('bus-y'),
        });
    });

    it('refuses the same forgery through the batch compile', () => {
        expect(() =>
            compileVersionedCommandBatchEnvelope({
                runId: 'run-1',
                batchId: 'batch-1',
                projectId: 'project-1',
                baseRevision: 'revision-1',
                intent: 'Forge a collision',
                commands: [JSON.stringify(renameClipTarget()), JSON.stringify(addClipCollision())],
            })
        ).toThrow(/clip-p/);
    });

    // The legitimate literal shape: command 2 references the id command 1 creates, the
    // batch declares it absent before and existing after, and the reference comes after
    // the creation.
    it('admits a literal reference to an id an earlier command creates', () => {
        const track = commandFor(
            {
                type: 'addTrack',
                payload: {
                    name: 'Piano',
                    kind: 'audio',
                    id: 'track-new',
                    initialAlternativeId: 'alt-new',
                    color: '#123456',
                },
            },
            [
                { argument: 'id', value: 'track-new' },
                { argument: 'initialAlternativeId', value: 'alt-new' },
            ]
        );
        const clip = commandFor(
            {
                type: 'addClip',
                payload: { trackId: 'track-new', startBeat: 0, endBeat: 4, name: 'Melody', id: 'clip-new' },
            },
            [{ argument: 'id', value: 'clip-new' }]
        );
        const serialized = batchEnvelope([track, clip], {
            targetIds: ['track-new'],
            existingTargetIds: [],
        });

        expect(parseVersionedCommandBatchEnvelope(serialized)).toMatchObject({ status: 'valid' });
    });

    // The legitimate dependent exemption: a parameter of a device an earlier command
    // creates cannot be a base-revision target, so the dependsOn rule shelters it —
    // but only because the device is created earlier in the batch.
    it('admits a dependsOn parameter of a device an earlier command creates', () => {
        const device = commandFor(
            {
                type: 'addDevice',
                payload: { trackId: 'track-a', deviceType: 'eq-three-band', deviceId: 'device-new' },
            },
            [{ argument: 'deviceId', value: 'device-new' }]
        );
        const parameter = commandFor({
            type: 'setDeviceParameter',
            payload: { deviceId: 'device-new', paramId: 'gain', value: 0.5 },
        });
        const serialized = batchEnvelope([device, parameter], {
            targetIds: ['track-a', 'device-new'],
            existingTargetIds: ['track-a'],
        });

        expect(parseVersionedCommandBatchEnvelope(serialized)).toMatchObject({ status: 'valid' });
    });

    // The per-command #5044 refusal still holds under batch parse: an envelope whose
    // assigned id names an object the same command targets never reaches the batch checks.
    it('refuses a per-command assigned-id collision at the batch boundary', () => {
        const forgedSplit = commandFor(
            { type: 'splitClip', payload: { clipId: 'clip-m', beat: 3, rightClipId: 'clip-m' } },
            [{ argument: 'rightClipId', value: 'clip-m' }]
        );
        const serialized = JSON.stringify(forgedSplit);
        expect(parseVersionedCommandEnvelope(serialized)).toMatchObject({
            status: 'invalid',
            reason: 'Application-assigned command IDs are invalid',
        });
        expect(parseVersionedCommandBatchEnvelope(batchEnvelope([forgedSplit], { targetIds: ['clip-m'] })).status).toBe(
            'invalid'
        );
    });
});

describe('batch divergence targets against the sequence-aware created set', () => {
    // The approval preflight fingerprints existing objects a batch touches. An id created
    // later in the batch than another command's reference to it is that command's existing
    // target, so it keeps its fingerprint no matter which command assigns it.
    it('keeps a target referenced before the command that claims to create it', () => {
        const envelope: VersionedCommandBatchEnvelope = {
            schemaVersion: VERSIONED_COMMAND_BATCH_SCHEMA_VERSION,
            runId: 'run-1',
            batchId: 'batch-1',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            idempotencyKey: 'idempotency-1',
            intent: 'Forge a collision',
            mode: 'preview' as const,
            scope: {
                targetIds: ['clip-p'],
                targetRanges: [],
                protectedTargetIds: [],
                protectedRanges: [],
            },
            preconditions: [],
            commands: [renameClipTarget(), addClipCollision()],
            postconditions: [],
            dependencies: [],
            batchLocalBindings: [],
            dynamicEffects: undefined,
            grants: {
                allowedOperationPrefixes: ['add', 'rename'],
                create: true,
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
                maxAffectedClips: 2,
                maxAutomationPoints: 0,
                maxImportedAssets: 0,
                maxRenderJobs: 0,
            },
        };

        expect(getVersionedCommandBatchDivergenceTargetIds(envelope)).toContain('clip-p');
    });
});
