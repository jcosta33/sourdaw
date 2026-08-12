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
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
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
            applicationAssignedIds: [],
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
            applicationAssignedIds: [],
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
            applicationAssignedIds: [],
        };

        expect(parseVersionedCommandEnvelope(JSON.stringify({ ...base, schemaVersion: 2 })).status).toBe('invalid');
        expect(
            parseVersionedCommandEnvelope(JSON.stringify({ ...base, arguments: { bpm: 120, providerMayCommit: true } }))
                .status
        ).toBe('invalid');
        const undeclaredArguments = { bpm: 120, providerMayCommit: true };
        expect(
            parseVersionedCommandEnvelope(
                JSON.stringify({
                    ...base,
                    arguments: undeclaredArguments,
                    argumentsDigest: getVersionedCommandArgumentsDigest({
                        operation: base.operation,
                        arguments: undeclaredArguments,
                    }),
                })
            ).status
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

    it('materializes application-owned object identities before digesting and receipts them', () => {
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
            .mockReturnValueOnce('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
        vi.spyOn(Date, 'now').mockReturnValue(1_786_435_200_003);

        const command = createExecutionCommandEnvelope({
            action: { type: 'addTrack', payload: { name: 'Lead Vocal', kind: 'audio' } },
            expectedEffect: 'Add audio track "Lead Vocal"',
            normalizedProjectRevision: 'revision-1',
        });

        expect(command.action).toEqual({
            type: 'addTrack',
            payload: {
                id: 'track-command-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                name: 'Lead Vocal',
                kind: 'audio',
            },
        });
        expect(command.envelope.arguments).toEqual(command.action.payload);
        expect(command.envelope.applicationAssignedIds).toEqual([
            { argument: 'id', value: 'track-command-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        ]);
        expect(createVersionedCommandReceipt({ envelope: command.envelope }).applicationAssigned.ids).toEqual([
            { field: 'commandId', value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
            { field: 'objectId', value: 'track-command-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        ]);
    });

    it('materializes nested note identities before digesting and receipts every assignment', () => {
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
            .mockReturnValueOnce('22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
            .mockReturnValueOnce('33333333-cccc-4ccc-8ccc-cccccccccccc');

        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addNotes',
                payload: {
                    clipId: 'clip-1',
                    notes: [
                        { pitch: 60, startBeat: 0, duration: 1 },
                        { pitch: 64, startBeat: 1, duration: 1, velocity: 96 },
                    ],
                },
            },
            expectedEffect: 'Add two MIDI notes.',
            normalizedProjectRevision: 'revision-1',
        });

        expect(command.action).toEqual({
            type: 'addNotes',
            payload: {
                clipId: 'clip-1',
                notes: [
                    {
                        id: 'note-command-11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                        pitch: 60,
                        startBeat: 0,
                        duration: 1,
                    },
                    {
                        id: 'note-command-22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                        pitch: 64,
                        startBeat: 1,
                        duration: 1,
                        velocity: 96,
                    },
                ],
            },
        });
        expect(command.envelope.arguments).toEqual(command.action.payload);
        expect(command.envelope.applicationAssignedIds).toEqual([
            {
                argument: 'notes[0].id',
                value: 'note-command-11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            },
            {
                argument: 'notes[1].id',
                value: 'note-command-22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            },
        ]);
        expect(parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(command.envelope))).toEqual({
            status: 'valid',
            envelope: command.envelope,
        });
        expect(createVersionedCommandReceipt({ envelope: command.envelope }).applicationAssigned.ids).toEqual([
            { field: 'commandId', value: '33333333-cccc-4ccc-8ccc-cccccccccccc' },
            { field: 'objectId', value: 'note-command-11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
            { field: 'objectId', value: 'note-command-22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        ]);
    });

    it('rejects commands whose semantic result still depends on post-envelope generation', () => {
        const unsafeActions: AppAction[] = [
            { type: 'completeMidi', payload: { clipId: 'clip-1' } },
            { type: 'variationMidi', payload: { clipId: 'clip-1' } },
            { type: 'generateBassline', payload: { clipId: 'clip-1' } },
            { type: 'generateAudio', payload: { prompt: 'warm pad' } },
            { type: 'generateDrumPattern', payload: { style: 'rock' } },
            { type: 'generateMelody', payload: { style: 'ambient' } },
            { type: 'generateChordProgression', payload: { style: 'pop' } },
            { type: 'duplicateClip', payload: { clipId: 'clip-1' } },
            { type: 'duplicateClipToNextBar', payload: { clipId: 'clip-1' } },
            { type: 'duplicateTrack', payload: { trackId: 'track-1' } },
            { type: 'splitClip', payload: { clipId: 'clip-1', beat: 2 } },
            { type: 'deleteTime', payload: { startBeat: 4, endBeat: 8 } },
            { type: 'duplicateTimeRange', payload: { startBeat: 4, endBeat: 8 } },
            {
                type: 'createTrackAlternative',
                payload: { trackId: 'track-1', name: 'Take 2', duplicateActive: true },
            },
            {
                type: 'createPatternInstance',
                payload: { sourceClipId: 'clip-1', targetTrackId: 'track-1', startBeat: 0 },
            },
        ];

        for (const action of unsafeActions) {
            const command = createExecutionCommandEnvelope({
                action,
                expectedEffect: action.type,
                normalizedProjectRevision: 'revision-1',
            });
            expect(parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(command.envelope))).toEqual({
                status: 'invalid',
                reason: 'Command operation is not deterministic at the serialized boundary',
            });
        }
    });

    it('materializes an arm routing owner before digesting while preserving explicit null', () => {
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('44444444-dddd-4ddd-8ddd-dddddddddddd')
            .mockReturnValueOnce('55555555-eeee-4eee-8eee-eeeeeeeeeeee');

        const generated = createExecutionCommandEnvelope({
            action: { type: 'armTrack', payload: { trackId: 'track-1', armed: true } },
            expectedEffect: 'Arm track 1.',
            normalizedProjectRevision: 'revision-1',
        });
        expect(generated.action).toEqual({
            type: 'armTrack',
            payload: {
                trackId: 'track-1',
                armed: true,
                midiInputOwnerId: 'arm-command-44444444-dddd-4ddd-8ddd-dddddddddddd',
            },
        });
        expect(generated.envelope.applicationAssignedIds).toEqual([
            {
                argument: 'midiInputOwnerId',
                value: 'arm-command-44444444-dddd-4ddd-8ddd-dddddddddddd',
            },
        ]);

        const explicitNull = createExecutionCommandEnvelope({
            action: {
                type: 'armTrack',
                payload: { trackId: 'track-1', armed: false, midiInputOwnerId: null },
            },
            expectedEffect: 'Disarm track 1.',
            normalizedProjectRevision: 'revision-1',
        });
        expect(explicitNull.action).toEqual({
            type: 'armTrack',
            payload: { trackId: 'track-1', armed: false, midiInputOwnerId: null },
        });
        expect(explicitNull.envelope.applicationAssignedIds).toEqual([]);
    });

    it('rejects recomputed canonical arguments with invalid application-owned field types', () => {
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addTrack',
                payload: {
                    id: 'track-1',
                    initialAlternativeId: 'alternative-1',
                    name: 'Lead',
                    kind: 'audio',
                    color: '#fff',
                    select: true,
                },
            },
            expectedEffect: 'Add the Lead track.',
            normalizedProjectRevision: 'revision-1',
        });

        for (const invalidArguments of [
            { ...command.envelope.arguments, id: 1 },
            { ...command.envelope.arguments, initialAlternativeId: false },
            { ...command.envelope.arguments, color: 12 },
            { ...command.envelope.arguments, select: 'yes' },
        ]) {
            expect(
                parseVersionedCommandEnvelope(
                    JSON.stringify({
                        ...command.envelope,
                        arguments: invalidArguments,
                        argumentsDigest: getVersionedCommandArgumentsDigest({
                            operation: command.envelope.operation,
                            arguments: invalidArguments,
                        }),
                    })
                ).status
            ).toBe('invalid');
        }
    });

    it('rejects recomputed nested canonical arguments with invalid field types', () => {
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addNotes',
                payload: {
                    clipId: 'clip-1',
                    notes: [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1 }],
                },
            },
            expectedEffect: 'Add one MIDI note.',
            normalizedProjectRevision: 'revision-1',
        });
        const invalidArguments = {
            ...command.envelope.arguments,
            notes: [{ id: 'note-1', pitch: 'C4', startBeat: 0, duration: 1 }],
        };

        expect(
            parseVersionedCommandEnvelope(
                JSON.stringify({
                    ...command.envelope,
                    arguments: invalidArguments,
                    argumentsDigest: getVersionedCommandArgumentsDigest({
                        operation: command.envelope.operation,
                        arguments: invalidArguments,
                    }),
                })
            ).status
        ).toBe('invalid');
    });

    it('rejects recomputed nested argument extensions outside the canonical command shape', () => {
        const stem = {
            stemId: 'stem-kick',
            sourceName: 'Kick.wav',
            role: 'kick' as const,
            sourceTempo: 120,
            durationSeconds: 8,
            sourceBytes: 1024,
            decodedBytes: 4096,
            audioBufferId: 'buffer-kick',
            trackId: 'track-kick',
            trackName: 'Kick',
            trackGain: 1,
            trackPan: 0,
            clipId: 'clip-kick',
        };
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'importStemSet',
                payload: {
                    selectionId: 'selection-1',
                    groupName: 'Imported Stems',
                    projectTempo: 120,
                    folderId: 'folder-stems',
                    stems: [stem, { ...stem, stemId: 'stem-bass', trackId: 'track-bass', clipId: 'clip-bass' }],
                },
            },
            expectedEffect: 'Import the exact selected stems.',
            normalizedProjectRevision: 'revision-1',
        });
        const tamperedArguments = {
            ...command.envelope.arguments,
            stems: [
                { ...stem, providerMayCommit: true },
                { ...stem, stemId: 'stem-bass' },
            ],
        };

        expect(
            parseVersionedCommandEnvelope(
                JSON.stringify({
                    ...command.envelope,
                    arguments: tamperedArguments,
                    argumentsDigest: getVersionedCommandArgumentsDigest({
                        operation: command.envelope.operation,
                        arguments: tamperedArguments,
                    }),
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
