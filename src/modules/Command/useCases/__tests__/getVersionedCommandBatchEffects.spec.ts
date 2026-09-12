import { afterEach, describe, expect, it } from 'vitest';

import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type CommandObjectReference, type VersionedCommandEnvelope } from '../../models/VersionedCommandEnvelope';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { getVersionedCommandBatchEffects } from '../getVersionedCommandBatchEffects';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';

function baseEnvelope(): VersionedCommandEnvelope {
    return createExecutionCommandEnvelope({
        action: { type: 'setTrackGain', payload: { trackId: 'track-1', gain: 0.8, expectedGain: 1 } },
        expectedEffect: 'Set track gain',
        normalizedProjectRevision: 'revision-1',
    }).envelope;
}

function command(input: {
    operation: AppAction['type'];
    argumentsValue?: Readonly<Record<string, unknown>>;
    objectReferences?: readonly CommandObjectReference[];
}): VersionedCommandEnvelope {
    return {
        ...baseEnvelope(),
        operation: input.operation,
        arguments: input.argumentsValue ?? {},
        objectReferences: input.objectReferences ?? [],
    };
}

function compileBatch(action: AppAction) {
    const envelope = createExecutionCommandEnvelope({
        action,
        expectedEffect: 'Agent-proposed effect',
        normalizedProjectRevision: 'revision-1',
    }).envelope;
    return compileVersionedCommandBatchEnvelope({
        baseRevision: 'revision-1',
        batchId: 'batch-derived-grants',
        commands: [JSON.stringify(envelope)],
        intent: 'Carry the derived grants',
        mode: 'commit',
        projectId: 'project-derived-grants',
        runId: 'run-derived-grants',
    });
}

describe('getVersionedCommandBatchEffects', () => {
    afterEach(() => {
        clearHandlerRegistry();
    });

    it('classifies every independently governed authority family', () => {
        const effects = getVersionedCommandBatchEffects([
            command({ operation: 'addTrack' }),
            command({ operation: 'removeTrack' }),
            command({ operation: 'addSend' }),
            command({ operation: 'setTempo' }),
            command({ operation: 'setMasterGain' }),
            command({ operation: 'importStemSet' }),
        ]);

        expect([...effects.requiredGrants].sort()).toEqual([
            'audioUpload',
            'create',
            'delete',
            'file',
            'master',
            'routing',
            'tempo',
        ]);
    });

    it('requires create authority for the right-hand clip produced by splitClip', () => {
        const effects = getVersionedCommandBatchEffects([command({ operation: 'splitClip' })]);

        expect(effects.requiredGrants).toContain('create');
    });

    it('counts every independently governed batch budget', () => {
        const effects = getVersionedCommandBatchEffects([
            command({
                operation: 'importStemSet',
                argumentsValue: {
                    stems: [{ trackId: 'track-stem-1' }, { trackId: 'track-stem-2' }],
                },
            }),
            command({
                operation: 'removeClip',
                objectReferences: [
                    { argument: 'trackId', id: 'track-existing', scope: 'stable' },
                    { argument: 'clipId', id: 'clip-1', scope: 'stable' },
                ],
            }),
            command({
                operation: 'removeTrack',
                argumentsValue: {
                    expectedClipIds: ['clip-active'],
                    expectedAlternativeClipIds: ['clip-hidden'],
                },
            }),
            command({
                operation: 'automateSendRanges',
                argumentsValue: { trackIds: ['track-1', 'track-2'], sectionIds: ['section-1', 'section-2'] },
            }),
            command({
                operation: 'renderProjectSections',
                argumentsValue: { sectionIds: ['section-1', 'section-2', 'section-3'] },
            }),
        ]);

        expect(effects).toMatchObject({
            createdTracks: 3,
            deletedObjects: 4,
            automationPoints: 8,
            importedAssets: 2,
            renderJobs: 3,
        });
        expect([...effects.affectedTrackIds].sort()).toEqual(['track-existing', 'track-stem-1', 'track-stem-2']);
        expect([...effects.affectedClipIds]).toEqual(['clip-1']);
    });

    it('carries the create grant for a batch containing only drawClip and for one containing only addNotes', () => {
        expect(getVersionedCommandBatchEffects([command({ operation: 'drawClip' })]).requiredGrants).toContain(
            'create'
        );
        expect(getVersionedCommandBatchEffects([command({ operation: 'addNotes' })]).requiredGrants).toContain(
            'create'
        );
    });

    it('carries the delete grant for the object-removing transforms arpeggiate and quantizeAutomation', () => {
        expect(getVersionedCommandBatchEffects([command({ operation: 'arpeggiate' })]).requiredGrants).toContain(
            'delete'
        );
        expect(
            getVersionedCommandBatchEffects([command({ operation: 'quantizeAutomation' })]).requiredGrants
        ).toContain('delete');
    });

    it('compiles drawClip-only and addNotes-only batches whose parsed envelope carries the create grant', () => {
        // The envelope `grants` object parsed here is the exact one compileAgentRiskApproval
        // reads; a content-creating batch must arrive carrying the create grant.
        registerHandlerMap(getMidiNoteTransformHandlers());
        const drawClipBatch = compileBatch({
            type: 'drawClip',
            payload: { trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Drawn clip', type: 'midi', ripple: false },
        });
        const addNotesBatch = compileBatch({
            type: 'addNotes',
            payload: {
                clipId: 'clip-1',
                notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100, probability: 100 }],
            },
        });
        for (const compiled of [drawClipBatch, addNotesBatch]) {
            const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
            if (parsed.status === 'invalid') {
                throw new Error(parsed.reason);
            }
            expect(parsed.envelope.grants.create, compiled.serialized).toBe(true);
        }
    });
});
