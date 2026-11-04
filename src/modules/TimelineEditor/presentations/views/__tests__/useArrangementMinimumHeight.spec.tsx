import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { adjustmentLayerStore, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { chordTrackStore } from '#/modules/MIDI/stores';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultWorkspaceState } from '#/modules/WorkspaceShell/stores';

import { useWorkspaceState } from '../../hooks/useWorkspaceState';
import { useArrangementMinimumHeight } from '../useArrangementMinimumHeight';

const storeValues = vi.hoisted(() => new Map<object, unknown>());

vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: object, fallback?: unknown) => storeValues.get(store) ?? fallback,
}));

vi.mock('#/modules/Arrangement/presentations/views', () => ({
    ARRANGEMENT_BAR_HEIGHT: 22,
    BEAT_RULER_HEIGHT: 18,
    MARKER_LANE_HEIGHT: 20,
    TIMELINE_HORIZONTAL_SCROLLBAR_HEIGHT: 10,
    getAdjustmentLayerStripHeight: (layerCount: number) => (layerCount > 0 ? 28 + layerCount * 18 : 0),
}));

vi.mock('../Timeline/ChordTrackLane', () => ({
    CHORD_TRACK_LANE_HEIGHT: 26,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTimelineSurfaceMinimumHeight: () => 64,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { name: 'trackStore' },
    markerStore: { name: 'markerStore' },
    adjustmentLayerStore: { name: 'adjustmentLayerStore' },
}));

vi.mock('#/modules/MIDI/stores', () => ({
    chordTrackStore: { name: 'chordTrackStore' },
}));

vi.mock('#/modules/Preferences/stores', () => ({
    preferencesStore: { name: 'preferencesStore' },
}));

vi.mock('../../hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(),
}));

const audioTrack = { id: 'a', kind: 'audio' };

describe('useArrangementMinimumHeight', () => {
    beforeEach(() => {
        storeValues.clear();
        storeValues.set(trackStore, { tracks: [audioTrack], selectedTrackId: null });
        storeValues.set(markerStore, { markers: [], sections: [] });
        storeValues.set(adjustmentLayerStore, { layers: [] });
        storeValues.set(chordTrackStore, { enabled: false, events: [] });
        storeValues.set(preferencesStore, { showMinimap: false, timelineMinimapHeight: 28 });
        vi.mocked(useWorkspaceState).mockReturnValue({ ...defaultWorkspaceState, mode: 'arrange' });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('is the chrome, one track row and the scrollbar strip for an arrangement with tracks', () => {
        const { result } = renderHook(() => useArrangementMinimumHeight());

        expect(result.current).toBe(22 + 18 + 64 + 10);
    });

    it('adds the minimap at its persisted height while it is shown', () => {
        storeValues.set(preferencesStore, { showMinimap: true, timelineMinimapHeight: 40 });

        const { result } = renderHook(() => useArrangementMinimumHeight());

        expect(result.current).toBe(22 + 18 + 40 + 64 + 10);
    });

    it('adds the marker lane, chord lane and adjustment layers when present', () => {
        storeValues.set(markerStore, { markers: [{ id: 'm' }], sections: [] });
        storeValues.set(chordTrackStore, { enabled: true, events: [] });
        storeValues.set(adjustmentLayerStore, { layers: [{ id: 'l' }] });

        const { result } = renderHook(() => useArrangementMinimumHeight());

        expect(result.current).toBe(22 + 18 + 20 + 26 + (28 + 18) + 64 + 10);
    });

    it('adds the scratch pad height only while the pad is open', () => {
        vi.mocked(useWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            scratchPadOpen: true,
            scratchPadHeight: 150,
        });
        const { result: open } = renderHook(() => useArrangementMinimumHeight());

        vi.mocked(useWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            scratchPadOpen: false,
            scratchPadHeight: 150,
        });
        const { result: closed } = renderHook(() => useArrangementMinimumHeight());

        expect(open.current - closed.current).toBe(150);
    });

    it('reserves only the 30px header strip for a collapsed scratch pad', () => {
        vi.mocked(useWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            scratchPadOpen: true,
            scratchPadCollapsed: true,
            scratchPadHeight: 150,
        });

        const { result } = renderHook(() => useArrangementMinimumHeight());

        expect(result.current).toBe(22 + 18 + 64 + 10 + 30);
    });

    it('follows the live minimap resize preview over the persisted height', () => {
        storeValues.set(preferencesStore, { showMinimap: true, timelineMinimapHeight: 40 });
        vi.mocked(useWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            timelineMinimapPreviewHeight: 96,
        });

        const { result } = renderHook(() => useArrangementMinimumHeight());

        expect(result.current).toBe(22 + 18 + 96 + 64 + 10);
    });

    it('ignores a minimap preview while the minimap is hidden', () => {
        vi.mocked(useWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            timelineMinimapPreviewHeight: 96,
        });

        const { result } = renderHook(() => useArrangementMinimumHeight());

        expect(result.current).toBe(22 + 18 + 64 + 10);
    });

    it('is zero in the automation workspace, which does not mount the arrangement', () => {
        vi.mocked(useWorkspaceState).mockReturnValue({ ...defaultWorkspaceState, mode: 'automation' });

        const { result } = renderHook(() => useArrangementMinimumHeight());

        expect(result.current).toBe(0);
    });

    it('is zero while the project has only a master or folder track and the empty state shows', () => {
        storeValues.set(trackStore, {
            tracks: [
                { id: 'master', kind: 'master' },
                { id: 'folder', kind: 'folder' },
            ],
            selectedTrackId: null,
        });

        const { result } = renderHook(() => useArrangementMinimumHeight());

        expect(result.current).toBe(0);
    });
});
