import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    captureProjectRevision,
    createCrdtDoc,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
} from '#/modules/Project/stores';
import { buildProjectData } from '#/modules/Project/useCases';
import { type AgentRenderReceipt } from '#/utils/agentRenderReceipt';

import { trackStore } from '../../../stores';
import { createTrack } from '../../createTrack';
import { admitAgentRenderReceipt, type AgentRenderArtifactSnapshot } from '../admitAgentRenderReceipt';

// The revision check is the real one over a real CRDT document and a real save write.
const OWNER = { runId: 'run-1', workId: 'work-1', leaseId: 'lease-1', cancellationGeneration: 0 };
const LIVE_RUN = { runId: OWNER.runId, cancellationGeneration: OWNER.cancellationGeneration };

function receiptAt(sourceRevision: string): {
    receipt: Extract<AgentRenderReceipt, { phase: 'rendered' }>;
    artifact: AgentRenderArtifactSnapshot;
} {
    const provenance = {
        jobId: 'job-verse',
        sectionId: 'section-verse',
        sectionName: 'Verse',
        startBeat: 8,
        endBeat: 16,
        sampleRate: 44_100,
        tailSeconds: 0,
        sourceRevision,
    };
    return {
        receipt: {
            phase: 'rendered',
            owner: OWNER,
            provenance,
            contentAddress: 'content-address-1',
            frameCount: 4,
            channelCount: 2,
            renderedAt: 10,
        },
        artifact: { ...provenance, frameCount: 4, channelCount: 2, contentAddress: 'content-address-1' },
    };
}

function admit(sourceRevision: string) {
    const { receipt, artifact } = receiptAt(sourceRevision);
    return admitAgentRenderReceipt({
        receipt,
        liveRun: LIVE_RUN,
        mutation: { type: 'bounceSelection', trackId: 'track-1', startBeat: 8, endBeat: 16 },
        artifacts: [artifact],
    });
}

/** The root writes `saveProject` performs: a fresh save timestamp, then `buildProjectData`'s arrangement refresh. */
async function writeSave(): Promise<void> {
    const project = projectStore.value ?? defaultProjectStoreState;
    projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000, dirty: true });
    await buildProjectData({ includeAudioBuffers: false });
    flushAutomergeStorageWrites();
}

function moveFader(gain: number): void {
    const tracks = trackStore.value?.tracks ?? [];
    trackStore.set({
        tracks: tracks.map((track) => (track.id === 'track-1' ? { ...track, gain } : track)),
        selectedTrackId: null,
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

registerSupportingServicePorts();

beforeEach(() => {
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('render receipt admission after save test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    projectStore.set(defaultProjectStoreState);
    trackStore.set({
        tracks: [createTrack({ id: 'track-1', name: 'track-1', kind: 'audio' })],
        selectedTrackId: null,
        ghostClips: [],
    });
    arrangementStore.set({
        activeArrangementId: defaultArrangementId,
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
    });
    flushAutomergeStorageWrites();
});

afterEach(() => {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(defaultProjectStoreState);
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('admitAgentRenderReceipt after a save', () => {
    it('admits a receipt rendered before the project was saved', async () => {
        const revision = captureProjectRevision();
        await writeSave();
        expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(revision)).toBe(false);

        expect(admit(revision).status).toBe('admitted');
    });

    it('rejects a receipt rendered before a fader moved, saved or not', async () => {
        const revision = captureProjectRevision();
        moveFader(0.5);
        await writeSave();

        expect(admit(revision)).toEqual({ status: 'rejected', reason: 'stale-revision' });
    });
});
