import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { admitWorkflowMetricIntake } from '../admitWorkflowMetricIntake';
import { getSidechainRoutingPromptScope } from '../agentReference/getSidechainRoutingPromptScope';
import { getProjectContext } from '../getProjectContext';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { prepareMetricIntentCatalog } from '../prepareMetricIntentCatalog';
import { prepareWorkflowMetricScopes } from '../prepareWorkflowMetricScopes';

import { moveTrackFader, seedSavableProject, writeProjectSave } from './projectSaveFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();
const prompt = 'Reduce kick/bass masking without replacing either basic sound.';

beforeEach(() => {
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('workflow metric intake save test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    createCrdtDoc('child');
    registerCrdtStorageRuntime();
    const kick = createTrack({ id: 'kick', name: 'Kick', kind: 'audio' });
    const bass = createTrack({ id: 'bass', name: 'Bass', kind: 'audio' });
    bass.devices = [
        {
            id: 'compressor',
            name: 'Compressor',
            type: 'builtin-sidechain-compressor',
            bypassed: false,
            parameterValues: {},
        },
    ];
    trackStore.set({ tracks: [kick, bass], selectedTrackId: null, ghostClips: [] });
    seedSavableProject();
});

afterEach(() => {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(defaultProjectStoreState);
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
    removeCrdtDoc('child');
});

function fixture() {
    const context = getProjectContext();
    const revision = captureProjectRevision();
    const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: revision });
    const catalog = prepareMetricIntentCatalog({ prompt, answer });
    const sidechain = getSidechainRoutingPromptScope(prompt, context, revision);
    const scopes = prepareWorkflowMetricScopes({ sidechain });
    const objective = catalog.objectives.find((entry) =>
        entry.goals.every((goal) => goal.source.kind === 'unsupported')
    );
    if (sidechain.status !== 'request' || scopes.length !== 1 || objective === undefined) {
        throw new Error('Expected a finite sidechain scope and published objective');
    }
    const call = {
        id: 'workflow-intake',
        name: 'selectWorkflowCapability',
        arguments: {
            capabilityId: 'sidechain-routing',
            catalogId: catalog.catalogId,
            metricIntent: {
                kind: 'perceptual',
                uncertainty: 'none',
                objectives: [
                    {
                        objectiveId: objective.id,
                        scopeCandidateId: null,
                        referenceScopeCandidateId: null,
                        rangeCandidateId: null,
                    },
                ],
            },
        },
    };
    const input = { catalog, scopes, call, turn: 1 };
    const baseline = admitWorkflowMetricIntake(input);
    expect(baseline.status).toBe('admitted');
    expect(scopes[0]?.targetIds).toEqual(['kick', 'bass']);
    return { input, baseline, revision };
}

describe('workflow metric intake across project writes', () => {
    it('retains the original authority after a save', async () => {
        const { input, baseline, revision } = fixture();
        await writeProjectSave();
        expect(captureProjectRevision()).not.toBe(revision);
        const result = admitWorkflowMetricIntake(input);
        expect(result).toEqual(baseline);
        expect(result).toMatchObject({
            status: 'admitted',
            authority: {
                revision,
                catalogId: input.catalog.catalogId,
                projectId: input.catalog.projectId,
                selection: input.catalog.selection,
                callId: input.call.id,
                turn: input.turn,
                origin: 'admitted-workflow',
                kind: 'perceptual',
            },
            scope: input.scopes[0],
        });
        expect(result).not.toHaveProperty('commandBatch');
    });

    it.each([
        'saved edit',
        'unflushed edit',
        'edit and revert',
        'child edit',
        'root replacement',
        'selection',
    ] as const)('rejects %s', async (change) => {
        const { input, revision } = fixture();
        const state = trackStore.value;
        if (state === null) {
            throw new Error('Missing tracks');
        }
        const gain = state.tracks[0]?.gain;
        if (gain === undefined) {
            throw new Error('Missing Kick');
        }
        if (change === 'saved edit') {
            moveTrackFader('kick', 0.5);
            await writeProjectSave();
        }
        if (change === 'unflushed edit') {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => (track.id === 'kick' ? { ...track, gain: 0.5 } : track)),
            });
            expect(captureProjectRevision()).toBe(revision);
        }
        if (change === 'edit and revert') {
            moveTrackFader('kick', 0.5);
            moveTrackFader('kick', gain);
            expect(trackStore.value?.tracks[0]?.gain).toBe(gain);
        }
        if (change === 'child edit') {
            mutateCrdtDoc({
                id: 'child',
                changeFn: (doc: Record<string, unknown>) => {
                    doc.value = 'changed';
                },
            });
        }
        if (change === 'root replacement') {
            removeCrdtDoc('root');
            createCrdtDoc('root');
        }
        if (change === 'selection') {
            trackStore.set({ ...state, selectedTrackId: 'kick' });
        }
        expect(admitWorkflowMetricIntake(input)).toEqual({
            status: 'rejected',
            reason: 'Workflow metric intake belongs to a stale project snapshot.',
        });
    });
});
