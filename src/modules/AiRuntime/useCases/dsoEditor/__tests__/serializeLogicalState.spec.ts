import { describe, it, expect, vi, beforeEach } from 'vitest';

import { dsoEditorState } from '../../../stores/dsoEditorState';
import { serializeLogicalState } from '../serializeLogicalState';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null as unknown },
    transportStoreValue: { value: null as unknown },
    workspaceStoreValue: { value: null as unknown },
    midiStoreValue: { value: null as unknown },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transportStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Workspace/stores', () => ({
    workspaceStore: {
        get value() {
            return mocks.workspaceStoreValue.value;
        },
    },
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
    },
}));

describe('serializeLogicalState', () => {
    beforeEach(() => {
        mocks.trackStoreValue.value = null;
        mocks.transportStoreValue.value = null;
        mocks.workspaceStoreValue.value = null;
        mocks.midiStoreValue.value = null;
        dsoEditorState.set({ revision: 0, recent_edits: [] });
    });

    it('should serialize full state with defaults when stores are empty', () => {
        const state = serializeLogicalState();

        expect(state.project_revision).toBe(1);
        expect(state.transport.tempo).toBe(120);
        expect(state.tracks).toEqual({});
        expect(state.track_order).toEqual([]);
        expect(state.clips).toEqual({});
        expect(state.devices).toEqual({});
        expect(state.selection).toEqual({ track_ids: [], clip_ids: [] });
    });

    it('should increment project revisions monotonically for each serialization', () => {
        const firstState = serializeLogicalState();
        const secondState = serializeLogicalState();

        expect(secondState.project_revision).toBe(firstState.project_revision + 1);
    });

    it('should serialize tracks, clips, and devices correctly', () => {
        mocks.trackStoreValue.value = {
            tracks: [
                {
                    id: 't1',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: true,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    clips: [{ id: 'c1', name: 'Vox 1', type: 'audio', startBeat: 0, endBeat: 4, gain: 1 }],
                    devices: [{ id: 'd1', type: 'EQ', bypassed: false }],
                },
                {
                    id: 't2',
                    name: 'Drums',
                    kind: 'midi',
                    muted: true,
                    soloed: false,
                    armed: true,
                    gain: 0.5,
                    pan: -10,
                    clips: [{ id: 'c2', name: 'Beat', type: 'midi', startBeat: 4, endBeat: 8 }],
                    devices: [],
                },
            ],
            selectedTrackId: 't1',
        };
        mocks.workspaceStoreValue.value = { selectedClipIds: ['c1'] };
        mocks.transportStoreValue.value = {
            tempo: 130,
            timeSignatureNumerator: 3,
            timeSignatureDenominator: 4,
            playheadPosition: 2,
        };
        mocks.midiStoreValue.value = { notesByClipId: { c2: [{}, {}] } };

        const state = serializeLogicalState({ includeNoteCount: true });

        expect(state.transport).toEqual({ tempo: 130, time_signature: [3, 4], playhead_beat: 2 });
        expect(state.track_order).toEqual(['t1', 't2']);
        expect(state.selection).toEqual({ track_ids: ['t1'], clip_ids: ['c1'] });
        expect(state.tracks.t1).toMatchObject({
            name: 'Vocals',
            kind: 'audio',
            muted: false,
            soloed: true,
            armed: false,
            gain: 0.8,
            pan: 0,
            clip_ids: ['c1'],
            device_ids: ['d1'],
        });
        expect(state.clips.c1).toEqual({
            name: 'Vox 1',
            type: 'audio',
            track_id: 't1',
            start_beat: 0,
            end_beat: 4,
            gain: 1,
        });
        expect(state.devices.d1).toMatchObject({
            type: 'EQ',
            track_id: 't1',
            bypassed: false,
        });
        expect(state.clips.c2).toMatchObject({
            name: 'Beat',
            type: 'midi',
            note_count: 2,
        });
    });

    it('should filter tracks by scopeTrackIds when provided', () => {
        mocks.trackStoreValue.value = {
            tracks: [
                { id: 't1', clips: [], devices: [] },
                { id: 't2', clips: [], devices: [] },
            ],
        };

        const state = serializeLogicalState({ scopeTrackIds: ['t2'] });

        expect(state.track_order).toEqual(['t2']);
        expect(state.tracks.t1).toBeUndefined();
        expect(state.tracks.t2).toBeDefined();
    });
});
