import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';

import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { executeVersionedCommandBatchEnvelope } from '../executeVersionedCommandBatchEnvelope';

describe('command batch preflight', () => {
    afterEach(() => {
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
    });

    it('rejects missing targets before the first handler effect', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
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
            targetFingerprints: {},
        }));
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-missing-target',
            batchId: 'batch-missing-target',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch target does not exist: track-vocal',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('aborts staged writes when a postcondition fails before commit', async () => {
        let stagedGain = 1;
        let captureCount = 0;
        const execute = vi.fn(() => {
            stagedGain = 0.8;
            return { status: 'written' as const };
        });
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => {
            captureCount += 1;
            return {
                audioGraphValid: captureCount === 1,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectInvariantsValid: true,
                targetFingerprints: { 'track-vocal': JSON.stringify({ gain: stagedGain }) },
            };
        });
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-invalid-graph',
            batchId: 'batch-invalid-graph',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toMatchObject({
            status: 'conflicted',
            reason: 'Command batch produced an invalid audio graph',
            actions: [],
        });
        expect(execute).toHaveBeenCalledTimes(2);
    });

    it('aborts staged writes when authoritative postcondition capture throws', async () => {
        let captureCount = 0;
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => {
            captureCount += 1;
            if (captureCount > 1) {
                throw new Error('capture failed');
            }
            return {
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectInvariantsValid: true,
                targetFingerprints: { 'track-vocal': 'vocal' },
            };
        });
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-capture-throw',
            batchId: 'batch-capture-throw',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'conflicted',
            reason: 'Command batch postcondition validation failed: capture failed',
            actions: [],
        });
        expect(execute).toHaveBeenCalledTimes(2);
    });

    it('rejects unavailable imported assets before dispatch', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            addClip: {
                execute,
                describe: () => ({
                    label: 'Add clip',
                    inverseAction: {
                        type: 'removeClip',
                        payload: { clipId: 'clip-1' },
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
            targetFingerprints: { 'track-1': JSON.stringify({ id: 'track-1' }) },
        }));
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addClip',
                payload: {
                    id: 'clip-1',
                    trackId: 'track-1',
                    startBeat: 0,
                    endBeat: 4,
                    name: 'Missing asset',
                    type: 'audio',
                    audioBufferId: 'buffer-missing',
                    assetHash: 'sha256:missing',
                },
            },
            expectedEffect: 'Add clip',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-missing-asset',
            batchId: 'batch-missing-asset',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Add audio clip',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch asset is unavailable: buffer-missing',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('requires application-assigned created targets to be absent before and present after execution', async () => {
        let captureCount = 0;
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            addClip: {
                execute,
                describe: () => ({
                    label: 'Add clip',
                    inverseAction: {
                        type: 'removeClip',
                        payload: { clipId: 'clip-1' },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => {
            captureCount += 1;
            const targetFingerprints: Record<string, string> = { 'track-1': 'track' };
            if (captureCount > 1) {
                targetFingerprints['clip-1'] = 'clip';
            }
            return {
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectInvariantsValid: true,
                targetFingerprints,
            };
        });
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addClip',
                payload: { id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Verse' },
            },
            expectedEffect: 'Add clip',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-create',
            batchId: 'batch-create',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Add clip',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toMatchObject({ status: 'committed', actions: [{ action: { type: 'addClip' } }] });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('rejects overlap with an authoritative locked range before dispatch', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            addSection: {
                execute,
                describe: () => ({
                    label: 'Add section',
                    inverseAction: {
                        type: 'removeSection',
                        payload: { sectionId: 'section-1' },
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
            lockedRanges: [{ startBeat: 8, endBeat: 16 }],
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addSection',
                payload: { sectionId: 'section-1', startBeat: 12, endBeat: 20, name: 'Chorus' },
            },
            expectedEffect: 'Add section',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-locked-range',
            batchId: 'batch-locked-range',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Add chorus',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch target range is locked',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects oversized serialized batches before JSON parsing or dispatch', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({ label: 'Set gain', inverseAction: null }),
                undoable: false,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectInvariantsValid: true,
            targetFingerprints: { 'track-vocal': 'fingerprint' },
        }));
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-oversized',
            batchId: 'batch-oversized',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: `${compiled.serialized}${' '.repeat(1_048_576)}`,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch exceeds the serialized payload limit',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects before dispatch when authoritative preflight state is unavailable', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-preflight',
            batchId: 'batch-preflight',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch preflight state is unavailable',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });
});
