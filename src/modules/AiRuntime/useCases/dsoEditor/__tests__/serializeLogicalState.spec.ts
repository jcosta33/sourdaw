import { describe, it, expect, vi, beforeEach } from 'vitest';

import { serializeLogicalState, buildProjectSummary, getRevision, logEdit } from '../serializeLogicalState';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null } as any,
    transportStoreValue: { value: null } as any,
    workspaceStoreValue: { value: null } as any,
    midiStoreValue: { value: null } as any,
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
        vi.clearAllMocks();
        mocks.trackStoreValue.value = null;
        mocks.transportStoreValue.value = null;
        mocks.workspaceStoreValue.value = null;
        mocks.midiStoreValue.value = null;
    });

    describe('logEdit & getRevision', () => {
        it('tracks revisions on serialization', () => {
            const initial = getRevision();
            serializeLogicalState();
            expect(getRevision()).toBe(initial + 1);
        });

        it('logs edits and caps them to 5', () => {
            for (let i = 0; i < 6; i++) {
                logEdit(`Edit ${i}`);
            }
            const summary = buildProjectSummary();
            expect(summary.recent_edits).toHaveLength(5);
            expect(summary.recent_edits[0]).toBe('Edit 1');
            expect(summary.recent_edits[4]).toBe('Edit 5');
        });
    });

    describe('serializeLogicalState', () => {
        it('serializes full state with defaults when stores are empty', () => {
            const state = serializeLogicalState();

            expect(state.transport.tempo).toBe(120);
            expect(state.tracks).toEqual({});
            expect(state.track_order).toEqual([]);
            expect(state.clips).toEqual({});
            expect(state.devices).toEqual({});
            expect(state.selection).toEqual({ track_ids: [], clip_ids: [] });
        });

        it('serializes tracks, clips, and devices correctly', () => {
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

            // Check t1 audio track
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

            // Check t2 midi track
            expect(state.clips.c2).toMatchObject({
                name: 'Beat',
                type: 'midi',
                note_count: 2,
            });
        });

        it('filters tracks by scopeTrackIds if provided', () => {
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

    describe('buildProjectSummary', () => {
        it('builds a summary with track routing info', () => {
            mocks.trackStoreValue.value = {
                tracks: [{ name: 'T1' }, { name: 'T2' }],
                selectedTrackId: 't1',
            };

            const summary = buildProjectSummary();
            expect(summary.track_count).toBe(2);
            expect(summary.selected_tracks).toEqual(['t1']);
            expect(summary.routing_summary).toBe('T1, T2 → Master');
        });

        it('truncates routing summary for many tracks', () => {
            mocks.trackStoreValue.value = {
                tracks: Array.from({ length: 10 }, (_, i) => ({ name: `T${i}` })),
            };

            const summary = buildProjectSummary();
            expect(summary.routing_summary).toBe('T0, T1, T2, T3, T4, T5, T6, T7 +2 more → Master');
        });

        it('handles empty routing gracefully', () => {
            mocks.trackStoreValue.value = { tracks: [] };
            const summary = buildProjectSummary();
            expect(summary.routing_summary).toBe('Empty project');
        });
    });
});
