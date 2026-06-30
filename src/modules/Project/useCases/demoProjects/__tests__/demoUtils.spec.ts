import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getFactoryPresets } from '#/modules/Arrangement/useCases';

import { arrangementStore } from '../../../stores/arrangementStore';
import { applyPreset } from '../demoUtils/applyPreset';
import { syncArrangement } from '../demoUtils/syncArrangement';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getFactoryPresets: vi.fn<typeof getFactoryPresets>(),
}));

vi.mock('../../../stores/arrangementStore', () => ({
    arrangementStore: { set: vi.fn(), value: null },
    defaultArrangementId: 'default-arrangement-id',
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { value: { lanes: [] }, set: vi.fn() },
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        set: vi.fn(),
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: { value: { markers: [], sections: [] }, set: vi.fn() },
}));

type SyncArrangementTrack = Parameters<typeof syncArrangement>[0][number];

type CreateTrackOutput = SyncArrangementTrack;

function create_track(track_id: string): CreateTrackOutput {
    const alternative_id = `${track_id}-alternative`;

    return {
        id: track_id,
        name: 'Test Track',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
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
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: alternative_id,
        alternatives: [{ id: alternative_id, name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

type GetArrangementPayloadOutput = NonNullable<Parameters<typeof arrangementStore.set>[0]>;

function get_arrangement_payload(): GetArrangementPayloadOutput {
    const set = vi.mocked(arrangementStore.set);
    const payload = set.mock.calls[0]?.[0];
    if (!payload) {
        throw new Error('Expected arrangementStore.set to receive a payload');
    }
    return payload;
}

describe('applyPreset', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('copies devices with fresh ids and cloned parameter values when preset id matches', () => {
        const synth_parameters = { gain: 0.8 };
        const filter_parameters = { cutoff: 1200 };

        vi.mocked(getFactoryPresets).mockReturnValue([
            {
                id: 'preset-a',
                name: 'Preset A',
                category: 'synth',
                description: 'Test preset',
                trackKind: 'midi',
                devices: [
                    {
                        name: 'Synth',
                        type: 'synth',
                        parameterValues: synth_parameters,
                    },
                    {
                        name: 'Filter',
                        type: 'filter',
                        parameterValues: filter_parameters,
                    },
                ],
                tags: [],
                author: 'test',
                isFactory: true,
            },
        ]);

        const track: Parameters<typeof applyPreset>[0] = { devices: [] };
        applyPreset(track, 'preset-a');

        expect(track.devices).toHaveLength(2);
        const first_device = track.devices[0];
        const second_device = track.devices[1];
        if (!first_device || !second_device) {
            throw new Error('Expected applyPreset to copy two devices');
        }

        expect(first_device).toMatchObject({
            name: 'Synth',
            type: 'synth',
            bypassed: false,
            parameterValues: { gain: 0.8 },
        });
        expect(second_device).toMatchObject({
            name: 'Filter',
            type: 'filter',
            bypassed: false,
            parameterValues: { cutoff: 1200 },
        });
        expect(first_device.id).toMatch(/^dev-/);
        expect(second_device.id).toMatch(/^dev-/);
        expect(first_device.id).not.toBe(second_device.id);
        expect(first_device.parameterValues).not.toBe(synth_parameters);
        expect(second_device.parameterValues).not.toBe(filter_parameters);
    });
});

describe('syncArrangement', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('writes arrangement snapshot from current store values', () => {
        const set = vi.mocked(arrangementStore.set);
        const track = create_track('tr1');

        syncArrangement([track]);

        expect(set).toHaveBeenCalledTimes(1);
        const payload = get_arrangement_payload();
        const arrangement = payload.arrangements[0];
        if (!arrangement) {
            throw new Error('Expected syncArrangement to write one arrangement');
        }
        expect(arrangement.tracks.tracks).toEqual([track]);
        expect(arrangement.tracks.selectedTrackId).toBe('tr1');
    });

    it('selects null when syncing an empty track list', () => {
        const set = vi.mocked(arrangementStore.set);

        syncArrangement([]);

        expect(set).toHaveBeenCalledTimes(1);
        const payload = get_arrangement_payload();
        const arrangement = payload.arrangements[0];
        if (!arrangement) {
            throw new Error('Expected syncArrangement to write one arrangement');
        }
        expect(arrangement.tracks.tracks).toEqual([]);
        expect(arrangement.tracks.selectedTrackId).toBeNull();
    });
});
