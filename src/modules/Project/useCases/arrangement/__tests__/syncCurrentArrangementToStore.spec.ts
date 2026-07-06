import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ArrangementSnapshot, type ArrangementStoreState } from '../../../stores/arrangementStore';
import { syncCurrentArrangementToStore } from '../syncCurrentArrangementToStore';

type StoreMock<TValue> = {
    value: TValue | null;
};

type WritableStoreMock<TValue> = StoreMock<TValue> & {
    set: (value: TValue | null) => void;
};

const mocks = vi.hoisted(() => {
    function create_store_mock<TValue>(value: TValue | null): StoreMock<TValue> {
        return { value };
    }

    function create_writable_store_mock<TValue>(value: TValue | null): WritableStoreMock<TValue> {
        return { value, set: vi.fn<(new_value: TValue | null) => void>() };
    }

    return {
        arrangement_store: create_writable_store_mock<ArrangementStoreState>(null),
        automation_store: create_store_mock<ArrangementSnapshot['automation']>(null),
        marker_store: create_store_mock<NonNullable<ArrangementSnapshot['markers']>>(null),
        midi_store: create_store_mock<ArrangementSnapshot['midi']>(null),
        take_lane_store: create_store_mock<NonNullable<ArrangementSnapshot['takeLanes']>>(null),
        tempo_map_store: create_store_mock<NonNullable<ArrangementSnapshot['tempoMap']>>(null),
        time_signature_map_store: create_store_mock<NonNullable<ArrangementSnapshot['timeSignatureMap']>>(null),
        track_store: create_store_mock<ArrangementSnapshot['tracks']>(null),
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: mocks.marker_store,
    takeLaneStore: mocks.take_lane_store,
    trackStore: mocks.track_store,
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: mocks.automation_store,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: mocks.midi_store,
}));

vi.mock('#/modules/Transport/stores', () => ({
    tempoMapStore: mocks.tempo_map_store,
    timeSignatureMapStore: mocks.time_signature_map_store,
}));

vi.mock('../../../stores/arrangementStore', () => ({
    arrangementStore: mocks.arrangement_store,
}));

function reset_store_values(): void {
    vi.clearAllMocks();
    mocks.arrangement_store.value = null;
    mocks.automation_store.value = null;
    mocks.marker_store.value = null;
    mocks.midi_store.value = null;
    mocks.take_lane_store.value = null;
    mocks.tempo_map_store.value = null;
    mocks.time_signature_map_store.value = null;
    mocks.track_store.value = null;
}

describe('syncCurrentArrangementToStore', () => {
    beforeEach(() => {
        reset_store_values();
    });

    it('should replace only the active arrangement snapshot during sync', () => {
        const activeArrangement: ArrangementSnapshot = {
            id: 'arr-active',
            name: 'Active',
            tracks: { tracks: [], selectedTrackId: null },
            automation: { lanes: [] },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        };
        const inactiveArrangement: ArrangementSnapshot = {
            id: 'arr-inactive',
            name: 'Inactive',
            tracks: { tracks: [], selectedTrackId: 'old-track' },
            automation: { lanes: [] },
            midi: { notesByClipId: { old: [] }, ccByClipId: {}, pitchBendByClipId: {} },
        };
        const state: ArrangementStoreState = {
            arrangements: [activeArrangement, inactiveArrangement],
            activeArrangementId: 'arr-active',
        };
        const liveTracks: ArrangementSnapshot['tracks'] = { tracks: [], selectedTrackId: 'live-track' };
        const liveAutomation: ArrangementSnapshot['automation'] = { lanes: [] };
        const liveMidi: ArrangementSnapshot['midi'] = {
            notesByClipId: { 'clip-live': [] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        mocks.arrangement_store.value = state;
        mocks.track_store.value = liveTracks;
        mocks.automation_store.value = liveAutomation;
        mocks.midi_store.value = liveMidi;

        syncCurrentArrangementToStore();

        expect(mocks.arrangement_store.set).toHaveBeenCalledWith({
            ...state,
            arrangements: [
                {
                    id: 'arr-active',
                    name: 'Active',
                    tracks: liveTracks,
                    automation: liveAutomation,
                    midi: liveMidi,
                    tempoMap: undefined,
                    timeSignatureMap: undefined,
                    markers: undefined,
                    takeLanes: undefined,
                },
                inactiveArrangement,
            ],
        });
    });
});
