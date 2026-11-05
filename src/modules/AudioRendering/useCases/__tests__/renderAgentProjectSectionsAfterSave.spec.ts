import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectRevision,
    createCrdtDoc,
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
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { clearAgentSectionRenderArtifacts } from '../clearAgentSectionRenderArtifacts';
import { getAgentSectionRenderArtifacts } from '../getAgentSectionRenderArtifacts';
import { renderAgentProjectSections } from '../renderAgentProjectSections';

// The revision checks are the real ones over a real CRDT document and a real save write; only the
// offline renderer is replaced, so a save or an edit can land while a section renders.
const mocks = vi.hoisted(() => ({ renderOffline: vi.fn() }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    renderOffline: mocks.renderOffline,
}));

const JOB: RenderProjectSectionJobSnapshot = {
    jobId: 'render-verse',
    sectionId: 'section-verse',
    sectionName: 'Verse',
    startBeat: 0,
    endBeat: 16,
    sampleRate: 44_100,
    tailSeconds: 0,
};

function createAudioBuffer() {
    const channels = [new Float32Array(88_200), new Float32Array(88_200)];
    return {
        sampleRate: 44_100,
        length: 88_200,
        numberOfChannels: 2,
        duration: 2,
        getChannelData: (channel: number) => channels[channel],
    };
}

function createTrack(): Track {
    return {
        id: 'track-kick',
        name: 'Kick',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

/** The root writes `saveProject` performs: a fresh save timestamp, then `buildProjectData`'s arrangement refresh. */
async function writeSave(): Promise<void> {
    const project = projectStore.value ?? defaultProjectStoreState;
    projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000, dirty: true });
    await buildProjectData({ includeAudioBuffers: false });
    flushAutomergeStorageWrites();
}

function writeKickGain(gain: number): void {
    const tracks = trackStore.value?.tracks ?? [];
    trackStore.set({
        tracks: tracks.map((track) => ({ ...track, gain })),
        selectedTrackId: 'track-kick',
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

registerSupportingServicePorts();

describe('renderAgentProjectSections across a save', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAgentSectionRenderArtifacts();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('render sections after save test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        agentProjectRepairStateStore.set(null);
        projectStore.set(defaultProjectStoreState);
        trackStore.set({ tracks: [createTrack()], selectedTrackId: 'track-kick', ghostClips: [] });
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
        mocks.renderOffline.mockResolvedValue(createAudioBuffer());
    });

    afterEach(() => {
        clearAgentSectionRenderArtifacts();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        projectStore.set(defaultProjectStoreState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('renders and attaches against the committed revision after a save', async () => {
        const sourceRevision = captureProjectRevision();
        await writeSave();

        await renderAgentProjectSections({ jobs: [JOB], sourceRevision });

        expect(mocks.renderOffline).toHaveBeenCalledOnce();
        expect(getAgentSectionRenderArtifacts()).toEqual([expect.objectContaining({ sourceRevision })]);
    });

    it('attaches the artifact when a save lands while the section renders', async () => {
        const sourceRevision = captureProjectRevision();
        mocks.renderOffline.mockImplementation(async () => {
            await writeSave();
            return createAudioBuffer();
        });

        await renderAgentProjectSections({ jobs: [JOB], sourceRevision });

        expect(getAgentSectionRenderArtifacts()).toEqual([expect.objectContaining({ sourceRevision })]);
    });

    it('refuses to render after a track edit, saved or not', async () => {
        const sourceRevision = captureProjectRevision();
        writeKickGain(0.5);
        await writeSave();

        await expect(renderAgentProjectSections({ jobs: [JOB], sourceRevision })).rejects.toThrow();

        expect(mocks.renderOffline).not.toHaveBeenCalled();
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('drops the artifact when a track edit lands while the section renders', async () => {
        const sourceRevision = captureProjectRevision();
        mocks.renderOffline.mockImplementation(async () => {
            writeKickGain(0.5);
            await writeSave();
            return createAudioBuffer();
        });

        await expect(renderAgentProjectSections({ jobs: [JOB], sourceRevision })).rejects.toThrow(
            'Project changed during rendering; the artifact was not attached'
        );

        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });
});
