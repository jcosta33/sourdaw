import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { preferencesStore, type Preferences } from '#/modules/Preferences/stores';
import { setTrackHeight } from '#/modules/Preferences/useCases';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip } from '../../models/Track';
import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';
import { defaultTimelineEditingState, timelineEditingStore } from '../../stores/timelineEditingStore';
import { setScrollY, setTimelineTrackHeightPreview, timelineViewStore } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';
import { revealClip } from '../revealClip';
import { toggleInlineAutomation } from '../timelineEditing/toggleInlineAutomation';
import { hitTestAutomationSubLane } from '../timelineInteractions/hitTestAutomationSubLane';
import { hitTestClip } from '../timelineInteractions/hitTestClip/hitTestClip';

const targetClip: Clip = {
    id: 'clip-target',
    trackId: 'track-target',
    name: 'Missing take',
    startBeat: 120,
    endBeat: 136,
    type: 'audio',
    audioBufferId: 'buffer-missing',
    audioOffsetBeats: 0,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '',
    locked: false,
    muted: false,
};

describe('revealClip', () => {
    let previousMode: Preferences['trackHeight'];

    beforeEach(() => {
        previousMode = preferencesStore.value?.trackHeight ?? 'normal';
        setTrackHeight('normal');
        clipSelectionStore.set(defaultClipSelectionState);
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 10,
            autoScrollEnabled: true,
            viewportHeight: 100,
        });
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'track-first', height: 80 }),
                TrackDummy.create({ id: 'track-target', height: 60, clips: [targetClip] }),
            ],
            selectedTrackId: null,
        });
    });

    afterEach(() => {
        setTrackHeight(previousMode);
        timelineEditingStore.set(defaultTimelineEditingState);
    });

    describe('hidden tracks', () => {
        const hiddenTarget = (overrides: { hidden?: boolean; folderHidden?: boolean }) => {
            trackStore.set({
                tracks: [
                    TrackDummy.create({ id: 'track-first', height: 80 }),
                    TrackDummy.create({ id: 'folder', kind: 'folder', hidden: overrides.folderHidden ?? false }),
                    TrackDummy.create({
                        id: 'track-target',
                        height: 60,
                        clips: [targetClip],
                        hidden: overrides.hidden ?? false,
                        parentId: overrides.folderHidden === undefined ? null : 'folder',
                    }),
                ],
                selectedTrackId: null,
            });
        };

        it('reveals a hidden track clip by showing hidden tracks, and leaves the track hidden', () => {
            hiddenTarget({ hidden: true });

            expect(revealClip(targetClip.id)).toBe(true);

            expect(timelineEditingStore.value?.showHiddenTracks).toBe(true);
            expect(clipSelectionStore.value?.selectedClipId).toBe(targetClip.id);
            expect(trackStore.value?.tracks.find((track) => track.id === 'track-target')?.hidden).toBe(true);
            expect(timelineViewStore.value?.scrollY).toBe(66);
        });

        it('reveals a clip under a hidden folder', () => {
            hiddenTarget({ folderHidden: true });

            expect(revealClip(targetClip.id)).toBe(true);

            expect(timelineEditingStore.value?.showHiddenTracks).toBe(true);
            expect(clipSelectionStore.value?.selectedClipId).toBe(targetClip.id);
            expect(trackStore.value?.tracks.find((track) => track.id === 'folder')?.hidden).toBe(true);
        });

        it('reveals with hidden tracks already shown', () => {
            hiddenTarget({ hidden: true });
            timelineEditingStore.set({ ...defaultTimelineEditingState, showHiddenTracks: true });

            expect(revealClip(targetClip.id)).toBe(true);

            expect(clipSelectionStore.value?.selectedClipId).toBe(targetClip.id);
        });

        it('leaves the flag off when the track is shown', () => {
            hiddenTarget({});

            expect(revealClip(targetClip.id)).toBe(true);

            expect(timelineEditingStore.value?.showHiddenTracks).toBe(false);
        });
    });

    it('selects the clip and reveals its position without changing timeline zoom', () => {
        expect(revealClip(targetClip.id)).toBe(true);

        expect(clipSelectionStore.value).toMatchObject({
            selectedClipId: targetClip.id,
            selectedClipIds: [targetClip.id],
        });
        expect(timelineViewStore.value).toMatchObject({
            scrollX: 1168,
            scrollY: 40,
            pixelsPerBeat: 10,
        });
    });

    it('scrolls upward when the target track is above the viewport', () => {
        timelineViewStore.set({ ...timelineViewStore.value!, scrollY: 200 });

        expect(revealClip(targetClip.id)).toBe(true);

        expect(timelineViewStore.value?.scrollY).toBe(40);
    });

    it('includes preceding variation lanes when scrolling the target into view', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track-first',
                    height: 80,
                    showVariationLanes: true,
                    alternatives: [
                        { id: 'first-a', name: 'A', clips: [] },
                        { id: 'first-b', name: 'B', clips: [] },
                    ],
                }),
                TrackDummy.create({ id: 'track-target', height: 60, clips: [targetClip] }),
            ],
            selectedTrackId: null,
        });

        expect(revealClip(targetClip.id)).toBe(true);

        expect(timelineViewStore.value?.scrollY).toBe(88);
    });

    it.each([
        { mode: 'compact', preview: null, rowTop: 140, scrollY: 77.5, maxScrollY: 202.5 },
        { mode: 'large', preview: null, rowTop: 210, scrollY: 200, maxScrollY: 500 },
        { mode: 'large', preview: { trackId: 'track-first', height: 96 }, rowTop: 234, scrollY: 224, maxScrollY: 524 },
        { mode: 'large', preview: { trackId: 'track-target', height: 84 }, rowTop: 210, scrollY: 236, maxScrollY: 536 },
    ] as const)(
        'aligns reveal, clip and automation hit targets, and scroll bounds in $mode mode with preview $preview',
        ({ mode, preview, rowTop, scrollY, maxScrollY }) => {
            setTrackHeight(mode);
            trackStore.set({
                tracks: [
                    TrackDummy.create({ id: 'folder', kind: 'folder' }),
                    TrackDummy.create({
                        id: 'track-first',
                        height: 80,
                        showVariationLanes: true,
                        alternatives: [{ id: 'first-a', name: 'A', clips: [] }],
                    }),
                    TrackDummy.create({ id: 'track-target', height: 60, clips: [targetClip] }),
                    TrackDummy.create({ id: 'track-tail', height: 200 }),
                ],
                selectedTrackId: null,
            });
            if (preview) {
                setTimelineTrackHeightPreview(preview.trackId, preview.height);
            }
            const previousAutomation = automationStore.value;
            const previousEditing = timelineEditingStore.value;
            automationStore.set({
                lanes: [
                    {
                        id: 'pan',
                        trackId: 'track-first',
                        parameterId: 'pan',
                        parameterName: 'Pan',
                        points: [],
                        objects: [],
                        visible: true,
                        enabled: true,
                        collapsed: false,
                        minValue: -1,
                        maxValue: 1,
                    },
                ],
            });
            timelineEditingStore.set(defaultTimelineEditingState);
            try {
                toggleInlineAutomation();
                expect(hitTestAutomationSubLane(1220, rowTop - 41)).toBeNull();
                expect(hitTestAutomationSubLane(1220, rowTop - 40)?.lane.id).toBe('pan');
                expect(hitTestClip(1220, rowTop - 1)).toBeNull();
                expect(hitTestClip(1220, rowTop)).toEqual({ clipId: targetClip.id, trackId: targetClip.trackId });

                expect(revealClip(targetClip.id)).toBe(true);
                expect(timelineViewStore.value?.scrollY).toBe(scrollY);
                setScrollY(10_000);
                expect(timelineViewStore.value?.scrollY).toBe(maxScrollY);
            } finally {
                timelineEditingStore.set(previousEditing);
                automationStore.set(previousAutomation);
            }
        }
    );

    it('expands a collapsed owning folder before selecting its clip', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'folder', kind: 'folder', collapsed: true }),
                TrackDummy.create({
                    id: 'track-target',
                    parentId: 'folder',
                    height: 60,
                    clips: [targetClip],
                }),
            ],
            selectedTrackId: null,
        });

        expect(revealClip(targetClip.id)).toBe(true);

        expect(trackStore.value?.tracks[0]?.collapsed).toBe(false);
        expect(clipSelectionStore.value?.selectedClipId).toBe(targetClip.id);
    });

    it('shows variation lanes and scrolls to a clip in an inactive alternative', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'track-first', height: 80 }),
                TrackDummy.create({
                    id: 'track-target',
                    height: 60,
                    clips: [],
                    activeAlternativeId: 'active',
                    showVariationLanes: false,
                    alternatives: [
                        { id: 'active', name: 'Active', clips: [] },
                        { id: 'other', name: 'Other', clips: [] },
                        { id: 'missing', name: 'Missing', clips: [targetClip] },
                    ],
                }),
            ],
            selectedTrackId: null,
        });

        expect(revealClip(targetClip.id)).toBe(true);

        expect(trackStore.value?.tracks[1]?.showVariationLanes).toBe(true);
        expect(timelineViewStore.value?.scrollY).toBe(112);
        expect(clipSelectionStore.value?.selectedClipId).toBe(targetClip.id);
    });

    it('does not disturb the current view when the clip no longer exists', () => {
        const before = timelineViewStore.value;

        expect(revealClip('clip-deleted')).toBe(false);

        expect(timelineViewStore.value).toBe(before);
        expect(clipSelectionStore.value).toEqual(defaultClipSelectionState);
    });
});
