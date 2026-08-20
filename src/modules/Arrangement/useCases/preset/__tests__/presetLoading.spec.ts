import { describe, expect, it, vi, beforeEach } from 'vitest';

import { type SoundPreset } from '../../../models/SoundPreset';
import { compileLoadPresetActions } from '../compileLoadPresetActions';
import { matchesMaterializedPresetDevices } from '../matchesMaterializedPresetDevices';

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(() => 'project-1'),
    getFactoryPresets: vi.fn(),
    getTrackStoreState: vi.fn(),
    getUserPresets: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../soundPresetLibrary', () => ({
    getFactoryPresets: mocks.getFactoryPresets,
}));

vi.mock('../presetStorage/getUserPresets', () => ({
    getUserPresets: mocks.getUserPresets,
}));

function preset(overrides: Partial<SoundPreset> = {}): SoundPreset {
    return {
        id: 'preset-1',
        name: 'Glass Pad',
        category: 'pad',
        description: '',
        trackKind: 'midi',
        devices: [{ type: 'builtin-synth', name: 'Poly', parameterValues: { resonance: 0.3, cutoff: 0.6 } }],
        tags: [],
        author: 'test',
        isFactory: true,
        ...overrides,
    };
}

describe('compileLoadPresetActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getFactoryPresets.mockReturnValue([preset()]);
        mocks.getUserPresets.mockReturnValue([]);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    kind: 'midi',
                    frozen: false,
                    devices: [{ id: 'old-device', type: 'builtin-synth', parameterValues: { cutoff: 0.2 } }],
                },
            ],
        });
    });

    it('materializes an exact catalog-owned replacement for an existing track', () => {
        const plan = compileLoadPresetActions({ presetId: 'preset-1', trackId: 'track-1' });

        expect(plan).not.toBeNull();
        expect(plan?.actions).toHaveLength(1);
        expect(plan?.actions[0]).toMatchObject({
            type: 'loadPreset',
            payload: {
                presetId: 'preset-1',
                trackId: 'track-1',
                expectedProjectRevision: 'project-1',
                expectedFrozen: false,
                expectedBefore: {
                    id: 'track-1',
                    kind: 'midi',
                    devices: [{ id: 'old-device', type: 'builtin-synth', parameterIds: ['cutoff'] }],
                },
                devices: [
                    {
                        name: 'Poly',
                        type: 'builtin-synth',
                        bypassed: false,
                        parameterValues: { cutoff: 0.6, resonance: 0.3 },
                    },
                ],
            },
        });
    });

    it('compiles a new track and preset replacement as one command batch with matching planned topology', () => {
        const plan = compileLoadPresetActions({ presetId: 'preset-1' });

        expect(plan?.actions).toHaveLength(2);
        const add = plan?.actions[0];
        const load = plan?.actions[1];
        expect(add).toMatchObject({ type: 'addTrack', payload: { kind: 'midi', name: 'Glass Pad' } });
        expect(load).toMatchObject({ type: 'loadPreset', payload: { presetId: 'preset-1', expectedFrozen: false } });
        if (add?.type !== 'addTrack' || load?.type !== 'loadPreset') {
            throw new Error('Preset compiler did not emit the expected batch');
        }
        expect(load.payload.trackId).toBe(add.payload.id);
        expect(load.payload.expectedBefore.devices).toEqual([
            { id: add.payload.initialDeviceId, type: 'builtin-synth', parameterIds: [] },
        ]);
        expect(load.payload.expectedProjectRevision).toBeUndefined();
    });

    it('rejects an ambiguous catalog identity before it can become a project command', () => {
        mocks.getUserPresets.mockReturnValue([preset({ name: 'Shadow copy' })]);

        expect(compileLoadPresetActions({ presetId: 'preset-1', trackId: 'track-1' })).toBeNull();
    });

    it('rejects a preset containing a device withheld from release', () => {
        const withheldPreset = preset({
            devices: [{ type: 'grand-boule', name: 'Grand Boule', parameterValues: {} }],
        });
        mocks.getFactoryPresets.mockReturnValue([withheldPreset]);

        expect(compileLoadPresetActions({ presetId: 'preset-1', trackId: 'track-1' })).toBeNull();
        expect(
            matchesMaterializedPresetDevices(withheldPreset, [
                {
                    id: 'preset-device-1',
                    name: 'Grand Boule',
                    type: 'grand-boule',
                    bypassed: false,
                    parameterValues: {},
                },
            ])
        ).toBe(false);
    });

    it('rejects a caller snapshot with a missing or extra parameter before the handler writes', () => {
        const expected = preset();
        expect(
            matchesMaterializedPresetDevices(expected, [
                {
                    id: 'preset-device-1',
                    name: 'Poly',
                    type: 'builtin-synth',
                    bypassed: false,
                    parameterValues: { cutoff: 0.6 },
                },
            ])
        ).toBe(false);
    });
});
