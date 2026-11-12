import { beforeEach, describe, expect, it } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip } from '../../models/Track';
import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';
import { timelineViewStore } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';
import { revealClip } from '../revealClip';

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
    beforeEach(() => {
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
