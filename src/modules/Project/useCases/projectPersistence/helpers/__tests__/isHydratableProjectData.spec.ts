import { describe, expect, it } from 'vitest';

import { CURRENT_PROJECT_VERSION, type ProjectClip, type ProjectMeta } from '../../../../models/ProjectData';
import {
    isHydratableProjectData,
    type HydratableProjectData,
    type HydratableProjectTrack,
} from '../isHydratableProjectData';

const validMeta: ProjectMeta = {
    name: 'My Project',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    keyRoot: 0,
    scaleName: 'major',
    tuning: { name: '12-TET', frequencies: [261.63, 293.66] },
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
        meta: validMeta,
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
