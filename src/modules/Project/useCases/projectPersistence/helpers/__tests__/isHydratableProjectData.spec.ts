import { describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, isGrooveTemplateState, sanitizeGrooveTemplateState } from '#/modules/MIDI/stores';

import {
    CURRENT_PROJECT_VERSION,
    deriveProjectIdFromMeta,
    type ProjectClip,
    type ProjectMeta,
} from '../../../../models/ProjectData';
import {
    isHydratableProjectData,
    type HydratableProjectData,
    type HydratableProjectTrack,
} from '../isHydratableProjectData';
import { normalizeLegacyProjectData } from '../normalizeLegacyProjectData';

function createProject(grooves: unknown): Record<string, unknown> {
    return {
        version: 1,
        meta: {
            name: 'Groove validation',
            createdAt: 0,
            updatedAt: 0,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        arrangement: { tracks: [] },
        grooves,
    };
}

function createValidGrooves(): typeof defaultGrooveTemplateState {
    return {
        templates: [
            ...structuredClone(defaultGrooveTemplateState.templates),
            {
                id: 'roundtrip-pocket',
                name: 'Roundtrip pocket',
                schemaVersion: 1,
                subdivision: '1/16',
                slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0.2 }],
                provenance: { type: 'user', sourceId: 'roundtrip-source' },
            },
        ],
        assignments: [
            {
                consumerType: 'clip',
                consumerId: 'roundtrip-clip',
                templateId: 'roundtrip-pocket',
                amount: 0.75,
            },
        ],
    };
}

describe('isHydratableProjectData groove invariants', () => {
    it('shares canonical groove invariants and preserves a JSON roundtrip', () => {
        const grooves = createValidGrooves();
        const roundtrip = JSON.parse(JSON.stringify(grooves)) as unknown;

        expect(isGrooveTemplateState(roundtrip)).toBe(true);
        expect(sanitizeGrooveTemplateState(roundtrip)).toEqual(grooves);
        expect(isHydratableProjectData(createProject(roundtrip))).toBe(true);
    });

    it.each([
        {
            name: 'duplicate slots',
            mutate: (grooves: ReturnType<typeof createValidGrooves>) => {
                grooves.templates.at(-1)!.slots.push({ index: 1, timingOffset: 0.2, dynamicsOffset: 0 });
            },
        },
        {
            name: 'empty provenance source ID',
            mutate: (grooves: ReturnType<typeof createValidGrooves>) => {
                grooves.templates.at(-1)!.provenance.sourceId = '';
            },
        },
        {
            name: 'empty assignment consumer ID',
            mutate: (grooves: ReturnType<typeof createValidGrooves>) => {
                grooves.assignments[0]!.consumerId = '';
            },
        },
    ])('rejects $name before hydration can sanitize it', ({ mutate }) => {
        const grooves = createValidGrooves();
        mutate(grooves);

        expect(isGrooveTemplateState(grooves)).toBe(false);
        expect(isHydratableProjectData(createProject(grooves))).toBe(false);
    });

    it('does not coerce malformed current-schema groove data into validity', () => {
        const grooves = createValidGrooves();
        grooves.templates.at(-1)!.slots[0]!.timingOffset = Number.NaN;
        const currentProject = normalizeLegacyProjectData(createProject(grooves));

        const normalized = normalizeLegacyProjectData(currentProject);

        expect(normalized).toEqual(currentProject);
        expect(isHydratableProjectData(normalized)).toBe(false);
    });

    it('accepts durable Yeast processor identity and rejects noncanonical IDs', () => {
        const project = {
            ...createProject(createValidGrooves()),
            yeast: {
                processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }],
            },
        };
        expect(isHydratableProjectData(project)).toBe(true);

        project.yeast.processors[0]!.id = ' groove-1 ';
        expect(isHydratableProjectData(project)).toBe(false);
    });

    it('rejects local Yeast view state in collaborative project data', () => {
        const project = {
            ...createProject(createValidGrooves()),
            yeast: {
                processors: [],
                uiLevel: 3,
            },
        };

        expect(isHydratableProjectData(project)).toBe(false);
    });
});

const validMetaWithoutProjectId: ProjectMeta = {
    name: 'My Project',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    keyRoot: 0,
    scaleName: 'major',
    tuning: { name: '12-TET', frequencies: [261.63, 293.66] },
};
const validMeta: ProjectMeta = {
    ...validMetaWithoutProjectId,
    projectId: deriveProjectIdFromMeta(validMetaWithoutProjectId),
};

const validClip: ProjectClip = {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Clip 1',
    startBeat: 0,
    endBeat: 4,
    type: 'audio',
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#ffffff',
    locked: false,
    muted: false,
};

const validTrack: HydratableProjectTrack = {
    id: 'track-1',
    name: 'Track 1',
    kind: 'audio',
    clips: [validClip],
};

function buildValidProjectData(): HydratableProjectData {
    return {
        version: CURRENT_PROJECT_VERSION,
        meta: structuredClone(validMeta),
        arrangement: { tracks: [validTrack] },
    };
}

describe('isHydratableProjectData', () => {
    it('accepts the minimal required shape', () => {
        expect(isHydratableProjectData(buildValidProjectData())).toBe(true);
    });

    it('accepts a project with every optional section populated', () => {
        const data: HydratableProjectData = {
            ...buildValidProjectData(),
            transport: {
                tempo: 120,
                timeSignatureNumerator: 4,
                timeSignatureDenominator: 4,
                loopStart: 0,
                loopEnd: 8,
                isLooping: false,
                metronomeEnabled: false,
                metronomeVolume: 0.5,
                punchInEnabled: false,
                punchInBeat: 0,
                punchOutBeat: 0,
                countInEnabled: false,
                countInBars: 0,
                preRollEnabled: false,
                preRollBars: 0,
                masterGain: 1,
            },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            chordTrack: {
                enabled: true,
                events: [{ id: 'chord-1', beat: 0, root: 9, quality: 'minor', duration: 4 }],
            },
            automation: { lanes: [] },
            markers: [{ id: 'marker-1', beat: 0, name: 'Verse', color: '#000000' }],
            tempoMap: { changes: [{ beat: 0, tempo: 120, curve: 'instant' }] },
            timeSignatureMap: { changes: [{ beat: 0, numerator: 4, denominator: 4 }] },
            takeLanes: { lanes: [] },
            sidechainRoutes: [
                {
                    id: 'route-1',
                    sourceTrackId: 'track-1',
                    targetTrackId: 'track-1',
                    targetDeviceId: 'device-1',
                    targetParameterId: 'param-1',
                    gain: 1,
                },
            ],
            arrangements: [{ id: 'arrangement-1', name: 'Arrangement 1' }],
            activeArrangementId: 'arrangement-1',
            audioBuffers: {
                'buffer-1': { sampleRate: 44_100, numberOfChannels: 2, channelData: ['left-base64', 'right-base64'] },
            },
            adjustmentLayers: {
                layers: [
                    {
                        id: 'layer-1',
                        name: 'Layer 1',
                        effectType: 'eq',
                        parameters: [{ name: 'gain', value: 0, min: -12, max: 12, unit: 'db' }],
                        affectedTrackIds: ['track-1'],
                        insertionIndex: 0,
                        regions: [
                            { id: 'region-1', startBeat: 0, endBeat: 4, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 },
                        ],
                        enabled: true,
                        mix: 1,
                        color: '#ffffff',
                    },
                ],
            },
        };

        expect(isHydratableProjectData(data)).toBe(true);
    });

    it.each([
        ['null', null],
        ['a string', 'not-a-project'],
        ['an array', []],
        ['a number', 42],
        ['undefined', undefined],
    ] as const)('rejects %s as the top-level value', (_label, value) => {
        expect(isHydratableProjectData(value)).toBe(false);
    });

    it('rejects a non-integer version', () => {
        expect(isHydratableProjectData({ ...buildValidProjectData(), version: 1.5 })).toBe(false);
    });

    it('rejects a version outside the supported range', () => {
        expect(isHydratableProjectData({ ...buildValidProjectData(), version: 0 })).toBe(false);
        expect(isHydratableProjectData({ ...buildValidProjectData(), version: CURRENT_PROJECT_VERSION + 1 })).toBe(
            false
        );
    });

    it('rejects meta missing a required numeric field', () => {
        const metaMissingKeyRoot = {
            name: validMeta.name,
            createdAt: validMeta.createdAt,
            updatedAt: validMeta.updatedAt,
            scaleName: validMeta.scaleName,
            tuning: validMeta.tuning,
        };

        expect(isHydratableProjectData({ ...buildValidProjectData(), meta: metaMissingKeyRoot })).toBe(false);
    });

    it('rejects meta with a non-numeric tuning frequency', () => {
        expect(
            isHydratableProjectData({
                ...buildValidProjectData(),
                meta: { ...validMeta, tuning: { name: '12-TET', frequencies: [440, 'bad'] } },
            })
        ).toBe(false);
    });

    it('rejects arrangement.tracks that is not an array', () => {
        expect(isHydratableProjectData({ ...buildValidProjectData(), arrangement: { tracks: {} } })).toBe(false);
    });

    it('rejects a track with an unknown kind', () => {
        expect(
            isHydratableProjectData({
                ...buildValidProjectData(),
                arrangement: { tracks: [{ ...validTrack, kind: 'video' }] },
            })
        ).toBe(false);
    });

    it('rejects a clip with an invalid type', () => {
        expect(
            isHydratableProjectData({
                ...buildValidProjectData(),
                arrangement: { tracks: [{ ...validTrack, clips: [{ ...validClip, type: 'video' }] }] },
            })
        ).toBe(false);
    });

    it('rejects a track alternative containing a malformed clip', () => {
        expect(
            isHydratableProjectData({
                ...buildValidProjectData(),
                arrangement: {
                    tracks: [
                        {
                            ...validTrack,
                            alternatives: [{ id: 'alt-1', name: 'Alt 1', clips: [{ ...validClip, gain: 'loud' }] }],
                        },
                    ],
                },
            })
        ).toBe(false);
    });

    it('rejects a transport section missing a required field', () => {
        expect(
            isHydratableProjectData({
                ...buildValidProjectData(),
                transport: { tempo: 120 },
            })
        ).toBe(false);
    });

    it('keeps the optional chord-track field backward compatible with version-1 snapshots', () => {
        const project = buildValidProjectData();
        project.version = 1;
        delete project.meta.projectId;

        expect(isHydratableProjectData(project)).toBe(true);
    });

    it.each([
        {
            name: 'an out-of-range root',
            events: [{ id: 'chord-1', beat: 0, root: 12, quality: 'minor', duration: 4 }],
        },
        {
            name: 'events out of beat order',
            events: [
                { id: 'chord-1', beat: 4, root: 9, quality: 'minor', duration: 4 },
                { id: 'chord-2', beat: 0, root: 0, quality: 'major', duration: 4 },
            ],
        },
        {
            name: 'an empty event ID',
            events: [{ id: '', beat: 0, root: 9, quality: 'minor', duration: 4 }],
        },
        {
            name: 'duplicate event IDs',
            events: [
                { id: 'chord-1', beat: 0, root: 9, quality: 'minor', duration: 4 },
                { id: 'chord-1', beat: 4, root: 0, quality: 'major', duration: 4 },
            ],
        },
    ])('rejects chord-track imports with $name', ({ events }) => {
        expect(
            isHydratableProjectData({
                ...buildValidProjectData(),
                chordTrack: { enabled: true, events },
            })
        ).toBe(false);
    });

    it('rejects an audio buffer whose channelData length does not match numberOfChannels', () => {
        expect(
            isHydratableProjectData({
                ...buildValidProjectData(),
                audioBuffers: {
                    'buffer-1': { sampleRate: 44_100, numberOfChannels: 2, channelData: ['only-one'] },
                },
            })
        ).toBe(false);
    });

    it('rejects embedded freeze ownership that disagrees with the project envelope', () => {
        const project = buildValidProjectData();
        project.arrangement = {
            tracks: [
                {
                    ...validTrack,
                    freezeState: { status: 'frozen', frozenBufferId: 'freeze-track-1' },
                },
            ],
        };
        const audioBuffer = {
            sampleRate: 44_100,
            numberOfChannels: 1,
            channelData: ['audio'],
        };

        expect(
            isHydratableProjectData({
                ...project,
                audioBuffers: {
                    'freeze-track-1': { ...audioBuffer, freezeProjectId: project.meta.createdAt },
                    'legacy-track-1': audioBuffer,
                },
            })
        ).toBe(true);

        expect(
            isHydratableProjectData({
                ...project,
                audioBuffers: {
                    'freeze-track-1': {
                        ...audioBuffer,
                        freezeProjectId: project.meta.createdAt + 1,
                    },
                },
            })
        ).toBe(false);
    });

    it('rejects freeze ownership on a buffer referenced only by an ordinary clip', () => {
        const project = buildValidProjectData();
        const bufferId = 'ordinary-buffer';

        expect(
            isHydratableProjectData({
                ...project,
                arrangement: {
                    tracks: [{ ...validTrack, clips: [{ ...validClip, bufferId }] }],
                },
                audioBuffers: {
                    [bufferId]: {
                        sampleRate: 44_100,
                        numberOfChannels: 1,
                        channelData: ['audio'],
                        freezeProjectId: project.meta.createdAt,
                    },
                },
            })
        ).toBe(false);
    });

    it('rejects freeze ownership when saved arrangements also reference the buffer as ordinary PCM', () => {
        const project = buildValidProjectData();
        const bufferId = 'mixed-buffer';

        expect(
            isHydratableProjectData({
                ...project,
                arrangement: {
                    tracks: [
                        {
                            ...validTrack,
                            clips: [],
                            freezeState: { status: 'frozen', frozenBufferId: bufferId },
                        },
                    ],
                },
                arrangements: [
                    {
                        id: 'saved-arrangement',
                        name: 'Saved arrangement',
                        tracks: {
                            tracks: [{ ...validTrack, clips: [{ ...validClip, bufferId }] }],
                            selectedTrackId: null,
                        },
                    },
                ],
                audioBuffers: {
                    [bufferId]: {
                        sampleRate: 44_100,
                        numberOfChannels: 1,
                        channelData: ['audio'],
                        freezeProjectId: project.meta.createdAt,
                    },
                },
            })
        ).toBe(false);
    });

    it('rejects owned freeze keys that encode a different project while preserving legacy ownership absence', () => {
        const project = buildValidProjectData();
        const bufferId = `freeze-project-${String(project.meta.createdAt + 1)}-track-1-123`;
        project.arrangement = {
            tracks: [
                {
                    ...validTrack,
                    clips: [],
                    freezeState: { status: 'frozen', frozenBufferId: bufferId },
                },
            ],
        };
        const audioBuffer = { sampleRate: 44_100, numberOfChannels: 1, channelData: ['audio'] };

        expect(
            isHydratableProjectData({
                ...project,
                audioBuffers: { [bufferId]: { ...audioBuffer, freezeProjectId: project.meta.createdAt } },
            })
        ).toBe(false);
        expect(isHydratableProjectData({ ...project, audioBuffers: { [bufferId]: audioBuffer } })).toBe(true);

        const matchingId = `freeze-project-${String(project.meta.createdAt)}-track-1-123`;
        project.arrangement.tracks[0]!.freezeState = { status: 'frozen', frozenBufferId: matchingId };
        expect(
            isHydratableProjectData({
                ...project,
                audioBuffers: { [matchingId]: { ...audioBuffer, freezeProjectId: project.meta.createdAt } },
            })
        ).toBe(true);
    });

    it('rejects an arrangement snapshot with a malformed selectedTrackId', () => {
        expect(
            isHydratableProjectData({
                ...buildValidProjectData(),
                arrangements: [
                    { id: 'arrangement-1', name: 'Arrangement 1', tracks: { tracks: [], selectedTrackId: 7 } },
                ],
            })
        ).toBe(false);
    });

    it('rejects adjustment layers with an unknown effect type', () => {
        expect(
            isHydratableProjectData({
                ...buildValidProjectData(),
                adjustmentLayers: {
                    layers: [
                        {
                            id: 'layer-1',
                            name: 'Layer 1',
                            effectType: 'distortion',
                            parameters: [],
                            affectedTrackIds: [],
                            insertionIndex: 0,
                            regions: [],
                            enabled: true,
                            mix: 1,
                            color: '#ffffff',
                        },
                    ],
                },
            })
        ).toBe(false);
    });

    it('rejects sidechain routes missing a required string field', () => {
        expect(
            isHydratableProjectData({
                ...buildValidProjectData(),
                sidechainRoutes: [{ id: 'route-1', sourceTrackId: 'track-1', gain: 1 }],
            })
        ).toBe(false);
    });
});
