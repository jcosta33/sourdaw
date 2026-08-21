import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isCanonicalProjectId, type ProjectData } from '../../models/ProjectData';
import { getAgentProjectModelContract } from '../getAgentProjectModelContract';
import { isHydratableProjectData } from '../projectPersistence/helpers/isHydratableProjectData';
import { normalizeLegacyProjectData } from '../projectPersistence/helpers/normalizeLegacyProjectData';

const LEGACY_CREATED_AT = 1_700_000_000_000;
const EXPECTED_PROJECT_ID = '405e744b-dead-843a-9395-86fdcd66368c';
const buildProjectDataMock = vi.hoisted(() => vi.fn());

vi.mock('../projectPersistence/fileIO/buildProjectData', () => ({ buildProjectData: buildProjectDataMock }));

function projectData(): ProjectData {
    return {
        version: 2,
        meta: {
            projectId: EXPECTED_PROJECT_ID,
            name: 'Contract Project',
            createdAt: LEGACY_CREATED_AT,
            updatedAt: LEGACY_CREATED_AT + 1,
            keyRoot: 0,
            scaleName: 'minor',
            tuning: { name: '12-TET', frequencies: [440] },
            productionBrief: {
                schemaVersion: 1,
                id: 'brief-contract-project',
                revision: 1,
                vision: 'Wide and restrained',
                references: [],
                hardConstraints: [],
                preferences: [],
                sectionGoals: [],
                trackRoles: [{ id: 'role-1', trackId: 'track-1', role: 'lead', createdAt: 1 }],
                locks: [
                    {
                        id: 'brief-lock',
                        scope: { kind: 'track', trackId: 'track-1' },
                        statement: 'Keep the lead',
                        createdAt: 2,
                    },
                ],
                decisions: [],
                unresolvedQuestions: [{ id: 'q-1', statement: 'Confirm outro', createdAt: 3 }],
                sourceRunLinks: [],
                supersedesBriefId: null,
                supersededByBriefId: null,
                createdAt: LEGACY_CREATED_AT,
                updatedAt: LEGACY_CREATED_AT,
            },
        },
        transport: {
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            loopStart: 4,
            loopEnd: 12,
            isLooping: true,
            metronomeEnabled: true,
            metronomeVolume: 0.5,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 0,
            countInEnabled: true,
            countInBars: 1,
            preRollEnabled: false,
            preRollBars: 0,
            masterGain: 0.9,
        },
        arrangement: {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Lead',
                    kind: 'audio',
                    muted: false,
                    soloed: true,
                    armed: true,
                    gain: 0.8,
                    pan: -0.1,
                    color: '#fff',
                    clips: [
                        {
                            id: 'clip-1',
                            trackId: 'track-1',
                            name: 'Lead take',
                            startBeat: 4,
                            endBeat: 12,
                            type: 'audio',
                            bufferId: 'buffer-1',
                            fileId: 'media/sha256.wav',
                            assetHash: 'sha256:asset-1',
                            sampleStartBeat: 1,
                            fadeInBeats: 0.25,
                            fadeOutBeats: 0.5,
                            gain: 0.7,
                            color: '#fff',
                            locked: true,
                            muted: false,
                            stretchMode: 'timestretch',
                            stretchRatio: 1.1,
                            loopEnabled: true,
                            loopLength: 8,
                        },
                        {
                            id: 'clip-midi',
                            trackId: 'track-1',
                            name: 'Lead MIDI',
                            startBeat: 12,
                            endBeat: 16,
                            type: 'midi',
                            midiOffsetBeats: 0.5,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#fff',
                            locked: false,
                            muted: false,
                            notes: [
                                {
                                    id: 'note-1',
                                    pitch: 64,
                                    startBeat: 12,
                                    duration: 1,
                                    velocity: 0.75,
                                    channel: 2,
                                    probability: 80,
                                    pressure: 0.2,
                                    slide: 0.3,
                                    pitchBend: 0.4,
                                    articulation: 'legato',
                                },
                            ],
                        },
                    ],
                    devices: [
                        {
                            id: 'device-1',
                            name: 'Compressor',
                            type: 'builtin-compressor',
                            bypassed: false,
                            parameterValues: { threshold: -18 },
                            deviceState: { version: 3, data: { mode: 'clean' } },
                        },
                    ],
                    sends: [{ busId: 'master', level: 0.25, preFader: true }],
                    midiFx: [],
                    frozen: true,
                    frozenBufferId: 'freeze-1',
                    freezeState: {
                        status: 'frozen',
                        compensationSeconds: 0.01,
                        renderSettings: {
                            sampleRate: 48_000,
                            bitDepth: 32,
                            channelCount: 2,
                            tailLengthSeconds: 1.5,
                        },
                    },
                    parentId: null,
                    collapsed: false,
                    inputMonitoring: 'on',
                    hidden: false,
                    disabled: true,
                    height: 80,
                    outputId: 'master',
                    automationMode: 'read',
                    groupId: 'group-1',
                    soloSafe: false,
                    notes: '',
                    inputId: 'input-1',
                    activeAlternativeId: 'alt-1',
                    alternatives: [{ id: 'alt-1', name: 'Main', clips: [] }],
                    vcaGroupId: null,
                    midiOutputTrackId: null,
                    followChordTrack: false,
                },
                {
                    id: 'master',
                    name: 'Master',
                    kind: 'master',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 1,
                    pan: 0,
                    color: '#000',
                    clips: [],
                    devices: [],
                    sends: [],
                    midiFx: [],
                    frozen: false,
                    freezeState: { status: 'unfrozen' },
                    parentId: null,
                    collapsed: false,
                    inputMonitoring: 'off',
                    hidden: false,
                    disabled: false,
                    height: 80,
                    outputId: 'hw_out',
                    automationMode: 'read',
                    groupId: null,
                    soloSafe: true,
                    notes: '',
                    inputId: null,
                    activeAlternativeId: 'master-alt',
                    alternatives: [{ id: 'master-alt', name: 'Main', clips: [] }],
                    vcaGroupId: null,
                    midiOutputTrackId: null,
                    followChordTrack: false,
                },
            ],
        },
        automation: {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ beat: 4, value: 0.8, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        },
        midi: {
            probabilitySeed: 7,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        },
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        markers: [{ id: 'marker-1', beat: 8, name: 'Hit', color: '#fff' }],
        tempoMap: { changes: [{ id: 'tempo-1', beat: 8, tempo: 124, curve: 'linear' }] },
        timeSignatureMap: { changes: [{ id: 'meter-1', beat: 8, numerator: 6, denominator: 8 }] },
        takeLanes: {
            lanes: [
                {
                    id: 'takes-1',
                    trackId: 'track-1',
                    takes: [
                        { id: 'take-1', clipId: 'clip-1', name: 'Take 1', startBeat: 4, endBeat: 12, selected: true },
                    ],
                    activeCompRegions: [{ startBeat: 4, endBeat: 8, takeId: 'take-1' }],
                },
            ],
        },
        sidechainRoutes: [
            {
                id: 'sidechain-1',
                sourceTrackId: 'track-1',
                targetTrackId: 'master',
                targetDeviceId: 'master-device',
                targetParameterId: 'sidechain',
                gain: 0.5,
            },
        ],
        arrangements: [
            {
                id: 'arrangement-1',
                name: 'Main',
                markers: {
                    markers: [{ id: 'marker-1', beat: 8, name: 'Hit', color: '#fff' }],
                    sections: [{ id: 'section-1', startBeat: 4, endBeat: 16, name: 'Verse', color: '#fff' }],
                },
            },
        ],
        activeArrangementId: 'arrangement-1',
        audioBuffers: {
            'buffer-1': { sampleRate: 48_000, numberOfChannels: 2, channelData: ['PCM-LEFT', 'PCM-RIGHT'] },
        },
        history: { checkpoints: [{ id: 'checkpoint-1', timestamp: 4, label: 'Start' }] },
    };
}

describe('agent project model contract', () => {
    beforeEach(() => {
        buildProjectDataMock.mockReset();
    });

    it('builds the no-input contract through project persistence without exposing media bytes', async () => {
        buildProjectDataMock.mockResolvedValueOnce({ data: projectData(), missingBufferCount: 0 });

        const contract = await getAgentProjectModelContract();

        expect(buildProjectDataMock).toHaveBeenCalledOnce();
        expect(contract?.identity.projectId).toBe(EXPECTED_PROJECT_ID);
        expect(JSON.stringify(contract)).not.toContain('PCM-LEFT');
        expect(JSON.stringify(contract)).not.toContain('channelData');
    });

    it('refuses a no-input contract while project persistence withholds a snapshot', async () => {
        buildProjectDataMock.mockResolvedValueOnce(null);

        await expect(getAgentProjectModelContract()).resolves.toBeNull();
        expect(buildProjectDataMock).toHaveBeenCalledOnce();
    });

    it('projects every AC-002 semantic without exposing large media bytes', async () => {
        const contract = await getAgentProjectModelContract({ projectData: projectData() });

        expect(contract).toMatchObject({
            schema: 'sourdaw.agent-project-model',
            schemaVersion: 1,
            projectSchemaVersion: 2,
            identity: { projectId: EXPECTED_PROJECT_ID, legacyProjectId: String(LEGACY_CREATED_AT) },
            metadata: { name: 'Contract Project' },
            sampleRate: 48_000,
            arrangement: { loop: { enabled: true, startBeat: 4, endBeat: 12 } },
            master: { trackId: 'master', gain: 0.9, outputId: 'hw_out' },
            settings: { countIn: { enabled: true, bars: 1 } },
        });
        expect(contract?.tempoMap).toContainEqual(expect.objectContaining({ tempo: 124 }));
        expect(contract?.meterMap).toContainEqual(expect.objectContaining({ numerator: 6 }));
        expect(contract?.markers).toContainEqual(expect.objectContaining({ id: 'marker-1' }));
        expect(contract?.sections).toContainEqual(expect.objectContaining({ id: 'section-1' }));
        expect(contract?.locks).toContainEqual(expect.objectContaining({ id: 'brief-lock' }));
        expect(contract?.warnings).toContain('Confirm outro');

        const track = contract?.tracks.find(({ id }) => id === 'track-1');
        expect(track).toMatchObject({
            order: 0,
            hierarchy: { parentId: null, groupId: 'group-1' },
            tags: [],
            role: 'lead',
            controls: { gain: 0.8, pan: -0.1, muted: false, soloed: true, armed: true, monitoring: 'on' },
            io: { inputId: 'input-1', outputId: 'master' },
            freeze: { status: 'frozen', compensationSeconds: 0.01 },
            locked: true,
        });
        expect(track?.devices[0]).toMatchObject({
            instanceId: 'device-1',
            type: 'builtin-compressor',
            version: 3,
            slot: 0,
            bypassed: false,
            parameters: [{ id: 'threshold', value: -18, unit: null }],
            ports: { inputs: [], outputs: [] },
            latencySeconds: null,
            tailSeconds: null,
            manifest: null,
        });
        expect(track?.sends).toEqual(['route:send:track-1:master:0']);
        expect(track?.sidechains).toEqual(['sidechain-1']);
        expect(track?.automation).toContainEqual(expect.objectContaining({ id: 'lane-1' }));

        const audioClip = track?.clips.find(({ id }) => id === 'clip-1');
        expect(audioClip).toMatchObject({
            source: { kind: 'audio', assetId: 'sha256:asset-1', storageKind: 'reference' },
            timing: { startBeat: 4, endBeat: 12, durationBeats: 8 },
            offset: { audioBeats: 1, midiBeats: 0 },
            loop: { enabled: true, lengthBeats: 8 },
            gain: 0.7,
            fades: { inBeats: 0.25, outBeats: 0.5 },
            stretch: { mode: 'timestretch', ratio: 1.1 },
            pitch: { keyRoot: null, scaleName: null },
            warp: { markers: [] },
            locks: ['clip:clip-1'],
        });
        expect(audioClip?.takes).toContainEqual(expect.objectContaining({ id: 'take-1' }));
        expect(audioClip?.comp).toContainEqual(expect.objectContaining({ takeId: 'take-1' }));
        expect(audioClip?.automation).toContainEqual(expect.objectContaining({ id: 'lane-1' }));

        const midiNote = track?.clips.find(({ id }) => id === 'clip-midi')?.midi?.notes[0];
        expect(midiNote).toMatchObject({
            pitch: 64,
            timing: { startBeat: 12, durationBeats: 1, releaseBeat: 13 },
            velocity: 0.75,
            channel: 2,
            probability: 80,
            articulation: 'legato',
            expression: { pressure: 0.2, slide: 0.3, pitchBend: 0.4 },
            perNoteAutomation: [],
            quantization: null,
            humanization: null,
            provenance: null,
        });

        expect(contract?.routing).toEqual(
            expect.arrayContaining([
                {
                    id: 'route:output:track-1',
                    type: 'output',
                    source: { trackId: 'track-1', portId: null },
                    target: { trackId: 'master', deviceId: null, parameterId: null },
                    gain: 0.8,
                    faderMode: 'post',
                    channelMap: null,
                    sidechain: false,
                    cyclePolicy: 'reject',
                    enabled: false,
                    groupId: 'group-1',
                },
                {
                    id: 'route:send:track-1:master:0',
                    type: 'send',
                    source: { trackId: 'track-1', portId: null },
                    target: { trackId: 'master', deviceId: null, parameterId: null },
                    gain: 0.25,
                    faderMode: 'pre',
                    channelMap: null,
                    sidechain: false,
                    cyclePolicy: 'reject',
                    enabled: false,
                    groupId: 'group-1',
                },
                {
                    id: 'sidechain-1',
                    type: 'sidechain',
                    source: { trackId: 'track-1', portId: null },
                    target: { trackId: 'master', deviceId: 'master-device', parameterId: 'sidechain' },
                    gain: 0.5,
                    faderMode: 'pre',
                    channelMap: null,
                    sidechain: true,
                    cyclePolicy: 'reject',
                    enabled: true,
                    groupId: null,
                },
            ])
        );
        expect(contract?.assets).toContainEqual(
            expect.objectContaining({
                id: 'sha256:asset-1',
                contentHash: 'sha256:asset-1',
                storageKind: 'reference',
                name: 'Lead take',
                durationSeconds: null,
                sampleRate: 48_000,
                channels: 2,
                format: 'wav',
                sourceMetadata: { fileId: 'media/sha256.wav', bufferId: 'buffer-1' },
            })
        );
        expect(JSON.stringify(contract)).not.toContain('PCM-LEFT');
        expect(JSON.stringify(contract)).not.toContain('channelData');
    });

    function legacyProject(): ProjectData {
        const legacy = projectData();
        legacy.version = 1;
        delete legacy.meta.projectId;
        legacy.meta.productionBrief = {
            ...legacy.meta.productionBrief!,
            id: 'production-brief',
        };
        return legacy;
    }

    function migrateLegacy(data: ProjectData) {
        const migrated = normalizeLegacyProjectData(data);
        if (!isHydratableProjectData(migrated)) {
            throw new Error('expected a hydratable migrated project');
        }
        return migrated;
    }

    it('mints distinct identities for same-createdAt default-brief legacy projects', () => {
        const first = migrateLegacy(legacyProject());
        const second = migrateLegacy(legacyProject());

        expect(isCanonicalProjectId(first.meta.projectId)).toBe(true);
        expect(isCanonicalProjectId(second.meta.projectId)).toBe(true);
        expect(first.meta.projectId).not.toBe(second.meta.projectId);
    });

    it('preserves migrated identity across production-brief replacement', () => {
        const migrated = migrateLegacy(legacyProject());
        const replacement = structuredClone(migrated);
        replacement.meta.productionBrief = {
            ...replacement.meta.productionBrief!,
            id: 'replacement-production-brief',
            supersedesBriefId: 'production-brief',
        };

        expect(normalizeLegacyProjectData(replacement)).toEqual(replacement);
        expect(replacement.meta.projectId).toBe(migrated.meta.projectId);
    });

    it('normalizes an already migrated project idempotently', () => {
        const migrated = migrateLegacy(legacyProject());

        expect(normalizeLegacyProjectData(migrated)).toEqual(migrated);
    });
});
