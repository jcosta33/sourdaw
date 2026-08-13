import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type CommandObjectReference, type VersionedCommandEnvelope } from '../../models/VersionedCommandEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { getVersionedCommandBatchEffects } from '../getVersionedCommandBatchEffects';

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

describe('getVersionedCommandBatchEffects', () => {
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
});
