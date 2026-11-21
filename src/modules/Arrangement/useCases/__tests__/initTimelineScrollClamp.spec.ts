import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automationStore, type AutomationLane } from '#/modules/Automation/stores';
import { preferencesStore } from '#/modules/Preferences/stores';
import { setTrackHeight } from '#/modules/Preferences/useCases';

import { createTrack, type Track } from '../../models/Track';
import { defaultTimelineEditingState, timelineEditingStore } from '../../stores/timelineEditingStore';
import { setScrollY, setTimelineViewportHeight, timelineViewStore } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';
import { initTimelineScrollClamp } from '../initTimelineScrollClamp';
import { setShowHiddenTracks } from '../timelineEditing/setShowHiddenTracks';
import { toggleInlineAutomation } from '../timelineEditing/toggleInlineAutomation';

function makeTrack(overrides: Partial<Track> & Pick<Track, 'id' | 'kind'>): Track {
    return {
        ...createTrack({
            id: overrides.id,
            kind: overrides.kind,
            name: overrides.id,
            initialDeviceId: `${overrides.id}-device`,
            initialAlternativeId: `${overrides.id}-alternative`,
        }),
        ...overrides,
    };
}

describe('initTimelineScrollClamp', () => {
    let stop: () => void;

    beforeEach(() => {
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
            viewportHeight: 0,
        });
        trackStore.set({ tracks: [], selectedTrackId: null });
        stop = initTimelineScrollClamp();
    });

    afterEach(() => {
        stop();
        timelineEditingStore.set(defaultTimelineEditingState);
        automationStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('pulls scrollY back to the new maximum when tracks are deleted while scrolled to the end', () => {
        const tracks = ['a', 'b', 'c'].map((id) => makeTrack({ id, kind: 'audio', height: 100 }));
        trackStore.set({ tracks, selectedTrackId: null });
        setTimelineViewportHeight(150);
        setScrollY(1000);
        expect(timelineViewStore.value?.scrollY).toBe(150);

        trackStore.set({ tracks: tracks.slice(0, 2), selectedTrackId: null });

        expect(timelineViewStore.value?.scrollY).toBe(50);
    });

    it('pulls scrollY back when a folder collapses and its children leave the layout', () => {
        const tracks = [
            makeTrack({ id: 'folder', kind: 'folder', collapsed: false }),
            makeTrack({ id: 'in-1', kind: 'audio', parentId: 'folder', height: 100 }),
            makeTrack({ id: 'in-2', kind: 'audio', parentId: 'folder', height: 100 }),
        ];
        trackStore.set({ tracks, selectedTrackId: null });
        setTimelineViewportHeight(100);
        setScrollY(1000);
        expect(timelineViewStore.value?.scrollY).toBe(126);

        trackStore.set({
            tracks: tracks.map((track) => (track.id === 'folder' ? { ...track, collapsed: true } : track)),
            selectedTrackId: null,
        });

        // Only the 26px folder row remains, which fits the 100px viewport.
        expect(timelineViewStore.value?.scrollY).toBe(0);
    });

    it('re-clamps after hiding inline rows or removing a live lane', () => {
        trackStore.set({ tracks: [makeTrack({ id: 'a', kind: 'audio', height: 100 })], selectedTrackId: 'a' });
        const lane: AutomationLane = {
            id: 'pan',
            trackId: 'a',
            parameterId: 'pan',
            parameterName: 'Pan',
            points: [],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: -1,
            maxValue: 1,
        };
        automationStore.set({ lanes: [lane] });
        setTimelineViewportHeight(80);

        toggleInlineAutomation();
        setScrollY(1000);
        expect(timelineViewStore.value?.scrollY).toBe(60);

        automationStore.set({ lanes: [] });
        expect(timelineViewStore.value?.scrollY).toBe(20);

        automationStore.set({ lanes: [lane] });
        setScrollY(1000);
        expect(timelineViewStore.value?.scrollY).toBe(60);

        toggleInlineAutomation();
        expect(timelineViewStore.value?.scrollY).toBe(20);
    });

    it('re-clamps when a track is hidden and when hidden tracks are shown again', () => {
        const tracks = ['a', 'b', 'c'].map((id) => makeTrack({ id, kind: 'audio', height: 100 }));
        trackStore.set({ tracks, selectedTrackId: null });
        setTimelineViewportHeight(100);
        setScrollY(1000);
        expect(timelineViewStore.value?.scrollY).toBe(200);

        trackStore.set({
            tracks: tracks.map((track) => (track.id === 'c' ? { ...track, hidden: true } : track)),
            selectedTrackId: null,
        });
        expect(timelineViewStore.value?.scrollY).toBe(100);

        setShowHiddenTracks(true);
        setScrollY(1000);
        expect(timelineViewStore.value?.scrollY).toBe(200);

        setShowHiddenTracks(false);
        expect(timelineViewStore.value?.scrollY).toBe(100);
    });

    it('leaves an in-range scrollY alone when tracks change', () => {
        const tracks = ['a', 'b', 'c'].map((id) => makeTrack({ id, kind: 'audio', height: 100 }));
        trackStore.set({ tracks, selectedTrackId: null });
        setTimelineViewportHeight(100);
        setScrollY(30);

        trackStore.set({
            tracks: [...tracks, makeTrack({ id: 'd', kind: 'audio', height: 100 })],
            selectedTrackId: null,
        });

        expect(timelineViewStore.value?.scrollY).toBe(30);
    });

    it('re-clamps the current vertical scroll when local row heights shrink', () => {
        const previousMode = preferencesStore.value?.trackHeight ?? 'normal';
        const tracks = ['a', 'b', 'c'].map((id) => makeTrack({ id, kind: 'audio', height: 80 }));
        try {
            setTrackHeight('normal');
            trackStore.set({ tracks, selectedTrackId: null });
            setTimelineViewportHeight(100);
            setScrollY(1000);
            expect(timelineViewStore.value?.scrollY).toBe(140);

            setTrackHeight('compact');

            expect(timelineViewStore.value?.scrollY).toBe(50);
            expect(trackStore.value?.tracks).toBe(tracks);
        } finally {
            setTrackHeight(previousMode);
        }
    });

    it('stops clamping once unsubscribed', () => {
        const tracks = ['a', 'b'].map((id) => makeTrack({ id, kind: 'audio', height: 100 }));
        trackStore.set({ tracks, selectedTrackId: null });
        setTimelineViewportHeight(100);
        setScrollY(1000);
        stop();

        trackStore.set({ tracks: [], selectedTrackId: null });

        expect(timelineViewStore.value?.scrollY).toBe(100);
    });
});
