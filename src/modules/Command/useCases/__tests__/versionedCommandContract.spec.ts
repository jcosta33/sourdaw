import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { createVersionedCommandReceipt } from '../createVersionedCommandReceipt';
import { executeVersionedCommandBatch } from '../executeVersionedCommandBatch';
import { executeVersionedCommandEnvelope } from '../executeVersionedCommandEnvelope';
import { getVersionedCommandArgumentsDigest } from '../getVersionedCommandArgumentsDigest';
import { getVersionedCommandSemanticFingerprint } from '../getVersionedCommandSemanticFingerprint';
import { migrateLegacyAppActionToVersionedCommandEnvelope } from '../migrateLegacyAppActionToVersionedCommandEnvelope';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

describe('versioned command contract', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        commandProjectRevisionPort.setProvider(captureProjectRevision);
    });

    afterEach(() => {
        clearHandlerRegistry();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        commandProjectRevisionPort.setProvider(null);
        vi.restoreAllMocks();
    });

    it('creates one complete deterministic envelope and identifies application assignments in its receipt', () => {
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
        vi.spyOn(Date, 'now').mockReturnValue(1_786_435_200_000);

        const envelope = createVersionedCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.7, expectedGain: 1 },
            },
            availableDeviceVersions: { 'builtin-compressor': '1.4.0' },
            dependencyIds: ['command-route-vocal'],
            expectedEffect: 'Lead Vocal gain changes from 1 linear gain to 0.7 linear gain.',
            groupId: 'group-vocal-mix',
            normalizedProjectRevision: 'revision-1',
            objectReferences: [{ argument: 'trackId', id: 'track-vocal', scope: 'stable' }],
            parameterUnits: [
                { argument: 'gain', unit: 'linear-gain' },
                { argument: 'expectedGain', unit: 'linear-gain' },
            ],
            reason: 'Balance the lead vocal.',
            time: [],
        });

        expect(envelope).toEqual({
            schemaVersion: 1,
            commandId: '11111111-1111-4111-8111-111111111111',
            issuedAt: 1_786_435_200_000,
            operation: 'setTrackGain',
            arguments: { trackId: 'track-vocal', gain: 0.7, expectedGain: 1 },
            argumentsDigest: getVersionedCommandArgumentsDigest({
                operation: 'setTrackGain',
                arguments: { trackId: 'track-vocal', gain: 0.7, expectedGain: 1 },
            }),
            groupId: 'group-vocal-mix',
            dependencyIds: ['command-route-vocal'],
            reason: 'Balance the lead vocal.',
            expectedEffect: 'Lead Vocal gain changes from 1 linear gain to 0.7 linear gain.',
            objectReferences: [{ argument: 'trackId', id: 'track-vocal', scope: 'stable' }],
            time: [],
            parameterUnits: [
                { argument: 'gain', unit: 'linear-gain' },
                { argument: 'expectedGain', unit: 'linear-gain' },
            ],
            seed: null,
            normalizedProjectRevision: 'revision-1',
            availableDeviceVersions: { 'builtin-compressor': '1.4.0' },
        });

        const serialized = serializeVersionedCommandEnvelope(envelope);
        expect(parseVersionedCommandEnvelope(serialized)).toEqual({ status: 'valid', envelope });
        expect(createVersionedCommandReceipt({ envelope, applicationAssignedIds: ['history-1'] })).toEqual({
            commandId: envelope.commandId,
            schemaVersion: 1,
            applicationAssigned: {
                ids: [
                    { field: 'commandId', value: envelope.commandId },
                    { field: 'historyId', value: 'history-1' },
                ],
                timestamps: [{ field: 'issuedAt', value: envelope.issuedAt }],
            },
        });
    });

    it('rejects malformed metadata, tampered arguments, and missing stochastic seeds', () => {
        const base = {
            schemaVersion: 1,
            commandId: '11111111-1111-4111-8111-111111111111',
            issuedAt: 1_786_435_200_000,
            operation: 'setTempo',
            arguments: { bpm: 120 },
            argumentsDigest: getVersionedCommandArgumentsDigest({ operation: 'setTempo', arguments: { bpm: 120 } }),
            dependencyIds: [],
            reason: 'Set the requested tempo.',
            expectedEffect: 'Tempo becomes 120 beats per minute.',
            objectReferences: [],
            time: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            normalizedProjectRevision: 'revision-1',
            availableDeviceVersions: {},
        };

        expect(parseVersionedCommandEnvelope(JSON.stringify({ ...base, schemaVersion: 2 })).status).toBe('invalid');
        expect(
            parseVersionedCommandEnvelope(JSON.stringify({ ...base, arguments: { bpm: 120, providerMayCommit: true } }))
                .status
        ).toBe('invalid');
        const invalidTypedArguments = { bpm: 'fast' };
        expect(
            parseVersionedCommandEnvelope(
                JSON.stringify({
                    ...base,
                    arguments: invalidTypedArguments,
                    argumentsDigest: getVersionedCommandArgumentsDigest({
                        operation: base.operation,
                        arguments: invalidTypedArguments,
                    }),
                })
            ).status
        ).toBe('invalid');
        expect(
            parseVersionedCommandEnvelope(
                JSON.stringify({
                    ...base,
                    operation: 'humanizeNotes',
                    arguments: { clipId: 'clip-1', amount: 0.25 },
                    objectReferences: [{ argument: 'clipId', id: 'clip-1', scope: 'stable' }],
                    parameterUnits: [{ argument: 'amount', unit: 'normalized' }],
                })
            ).status
        ).toBe('invalid');
    });

    it('serializes payload-free operations with an explicit empty argument object', () => {
        const envelope = createVersionedCommandEnvelope({
            action: { type: 'stopPlayback' },
            availableDeviceVersions: {},
            expectedEffect: 'Playback stops.',
            normalizedProjectRevision: 'revision-1',
            objectReferences: [],
            parameterUnits: [],
            reason: 'Stop transport playback.',
            time: [],
        });

        expect(envelope.arguments).toEqual({});
        expect(parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(envelope))).toEqual({
            status: 'valid',
            envelope,
        });
        const undeclaredArguments = { providerMayCommit: true };
        expect(
            parseVersionedCommandEnvelope(
                JSON.stringify({
                    ...envelope,
                    arguments: undeclaredArguments,
                    argumentsDigest: getVersionedCommandArgumentsDigest({
                        operation: envelope.operation,
                        arguments: undeclaredArguments,
                    }),
                })
            ).status
        ).toBe('invalid');
    });

    it('fingerprints semantic inputs independently from application IDs and timestamps', () => {
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
            .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
        vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200);
        const input = {
            action: {
                type: 'humanizeNotes' as const,
                payload: { clipId: 'clip-1', amount: 0.25, velocityAmount: 0.1, seed: 42 },
            },
            availableDeviceVersions: {},
            expectedEffect: 'Humanize clip timing and velocity deterministically.',
            normalizedProjectRevision: 'revision-1',
            objectReferences: [{ argument: 'clipId', id: 'clip-1', scope: 'stable' as const }],
            parameterUnits: [
                { argument: 'amount', unit: 'normalized' },
                { argument: 'velocityAmount', unit: 'normalized' },
            ],
            reason: 'Reduce mechanical timing.',
            seed: 42,
            time: [],
        };
        const first = createVersionedCommandEnvelope(input);
        const second = createVersionedCommandEnvelope(input);

        expect(first.commandId).not.toBe(second.commandId);
        expect(first.issuedAt).not.toBe(second.issuedAt);
        expect(getVersionedCommandSemanticFingerprint(first)).toBe(getVersionedCommandSemanticFingerprint(second));
        expect(
            getVersionedCommandSemanticFingerprint({
                ...second,
                dependencyIds: ['another-command'],
                expectedEffect: 'Different explanatory text.',
                reason: 'Different explanatory text.',
            })
        ).toBe(getVersionedCommandSemanticFingerprint(first));
        expect(
            getVersionedCommandSemanticFingerprint({
                ...second,
                seed: 43,
                arguments: { ...second.arguments, seed: 43 },
            })
        ).not.toBe(getVersionedCommandSemanticFingerprint(first));
    });

    it('replays one serialized envelope with the same semantic mutation and stable receipt', async () => {
        type SetPlaybackAction = Extract<AppAction, { type: 'setPlayback' }>;
        const observed: boolean[] = [];
        registerHandlerMap({
            setPlayback: {
                describe: () => ({ label: 'Start playback' }),
                execute: (action: SetPlaybackAction) => {
                    observed.push(action.payload.playing);
                    return { status: 'written' };
                },
                executionKind: 'runtime',
                undoable: false,
            },
        });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('33333333-3333-4333-8333-333333333333');
        vi.spyOn(Date, 'now').mockReturnValue(1_786_435_200_001);
        const envelope = createVersionedCommandEnvelope({
            action: { type: 'setPlayback', payload: { playing: true } },
            availableDeviceVersions: {},
            expectedEffect: 'Playback is running.',
            normalizedProjectRevision: captureProjectRevision(),
            objectReferences: [],
            parameterUnits: [],
            reason: 'Start transport playback.',
            time: [],
        });
        const migrated = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: { type: 'setPlayback', payload: { playing: true } },
            options: { skipUndo: true },
        });
        const serialized = serializeVersionedCommandEnvelope(envelope);

        const firstReceipt = await executeVersionedCommandEnvelope(serialized, { skipUndo: true });
        const secondReceipt = await executeVersionedCommandEnvelope(serialized, { skipUndo: true });

        expect(observed).toEqual([true, true]);
        expect(migrated).toMatchObject({
            schemaVersion: 1,
            operation: 'setPlayback',
            arguments: { playing: true },
            reason: 'Execute setPlayback from manual',
            expectedEffect: 'Start playback',
        });
        expect(secondReceipt).toEqual(firstReceipt);
        expect(firstReceipt.applicationAssigned).toEqual({
            ids: [{ field: 'commandId', value: envelope.commandId }],
            timestamps: [{ field: 'issuedAt', value: envelope.issuedAt }],
        });
    });

    it('executes serialized dependencies as one ordered project transaction', async () => {
        const document: Record<string, unknown> = {
            tempo: { bpm: 100 },
            meter: { numerator: 4, denominator: 4 },
        };
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => changeFn(document),
        });
        const tempoStorage = createAutomergeStorage<{ bpm: number }>('root', 'tempo');
        const meterStorage = createAutomergeStorage<{ numerator: number; denominator: number }>('root', 'meter');
        tempoStorage.hydrate?.();
        meterStorage.hydrate?.();
        registerHandlerMap({
            setTempo: {
                describe: () => ({ label: 'Set tempo' }),
                execute: () => tempoStorage.set({ bpm: 120 }),
                undoable: false,
            },
            setTimeSignature: {
                describe: () => ({ label: 'Set meter' }),
                execute: () => meterStorage.set({ numerator: 3, denominator: 4 }),
                undoable: false,
            },
        });
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('44444444-4444-4444-8444-444444444444')
            .mockReturnValueOnce('55555555-5555-4555-8555-555555555555');
        vi.spyOn(Date, 'now').mockReturnValue(1_786_435_200_002);
        const revision = captureProjectRevision();
        const tempo = createVersionedCommandEnvelope({
            action: { type: 'setTempo', payload: { bpm: 120 } },
            availableDeviceVersions: {},
            expectedEffect: 'Tempo becomes 120 beats per minute.',
            groupId: 'group-meter',
            normalizedProjectRevision: revision,
            objectReferences: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            reason: 'Set the song tempo.',
            time: [],
        });
        const meter = createVersionedCommandEnvelope({
            action: { type: 'setTimeSignature', payload: { numerator: 3, denominator: 4 } },
            availableDeviceVersions: {},
            dependencyIds: [tempo.commandId],
            expectedEffect: 'Meter becomes 3/4.',
            groupId: 'group-meter',
            normalizedProjectRevision: revision,
            objectReferences: [],
            parameterUnits: [
                { argument: 'numerator', unit: 'beats-per-bar' },
                { argument: 'denominator', unit: 'note-value' },
            ],
            reason: 'Set the song meter.',
            time: [],
        });

        const result = await executeVersionedCommandBatch({
            commands: [serializeVersionedCommandEnvelope(tempo), serializeVersionedCommandEnvelope(meter)],
            options: { groupId: 'ignored-by-versioned-batch', skipUndo: true },
        });

        expect(result.status).toBe('committed');
        expect(document).toEqual({ tempo: { bpm: 120 }, meter: { numerator: 3, denominator: 4 } });
        if (result.status === 'committed') {
            expect(result.actions.map((entry) => entry.receipt?.commandId)).toEqual([tempo.commandId, meter.commandId]);
        }
    });
});
