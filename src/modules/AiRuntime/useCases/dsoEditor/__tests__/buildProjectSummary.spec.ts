import { describe, it, expect, beforeEach, vi } from 'vitest';

import { dsoEditorState } from '../../../stores/dsoEditorState';
import { buildProjectSummary } from '../buildProjectSummary';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null as unknown },
    transportStoreValue: { value: null as unknown },
    workspaceStoreValue: { value: null as unknown },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
    clipSelectionStore: {
        get value() {
            return mocks.workspaceStoreValue.value;
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

describe('buildProjectSummary', () => {
    beforeEach(() => {
        mocks.trackStoreValue.value = null;
        mocks.transportStoreValue.value = null;
        mocks.workspaceStoreValue.value = null;
        dsoEditorState.set({ revision: 0, recent_edits: [] });
    });

    it('should build a summary with track routing info and shared edit state', () => {
        mocks.trackStoreValue.value = {
            tracks: [{ name: 'T1' }, { name: 'T2' }],
            selectedTrackId: 't1',
        };
        dsoEditorState.set({ revision: 4, recent_edits: ['Added T2'] });

        const summary = buildProjectSummary();

        expect(summary).toEqual({
            project_revision: 4,
            track_count: 2,
            selected_tracks: ['t1'],
            selected_clips: [],
            tempo: 120,
            routing_summary: 'T1, T2 → Master',
            recent_edits: ['Added T2'],
        });
    });

    it('should return a defensive copy of recent edits', () => {
        dsoEditorState.set({ revision: 2, recent_edits: ['Added drums'] });

        const summary = buildProjectSummary();
        summary.recent_edits.push('Mutated summary');

        expect(summary.recent_edits).toEqual(['Added drums', 'Mutated summary']);
        expect(dsoEditorState.value?.recent_edits).toEqual(['Added drums']);
        expect(summary.recent_edits).not.toBe(dsoEditorState.value?.recent_edits);
    });

    it('should truncate routing summary for many tracks', () => {
        mocks.trackStoreValue.value = {
            tracks: Array.from({ length: 10 }, (_, index) => ({ name: `T${index}` })),
        };

        const summary = buildProjectSummary();

        expect(summary.routing_summary).toBe('T0, T1, T2, T3, T4, T5, T6, T7 +2 more → Master');
    });

    it('should handle empty routing gracefully', () => {
        mocks.trackStoreValue.value = { tracks: [] };

        const summary = buildProjectSummary();

        expect(summary.routing_summary).toBe('Empty project');
    });
});
