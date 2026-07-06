import { beforeEach, describe, expect, it } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip } from '../../models/Track';
import { defaultMarkerStoreState, markerStore, type MarkerStoreState } from '../../stores/markerStore';
import { defaultTrackState, trackStore } from '../../stores/trackStore';
import { detectAndApplySongStructure } from '../detectAndApplySongStructure';
import { detectSongStructure } from '../detectSongStructure';

type CreateClipInput = {
    id: string;
    trackId: string;
    startBeat: number;
    endBeat: number;
    type: 'audio' | 'midi';
};

function create_clip(input: CreateClipInput): Clip {
    return {
        id: input.id,
        trackId: input.trackId,
        name: input.id,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: input.type,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
    };
}

describe('songStructureDetection', () => {
    beforeEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        markerStore.set(structuredClone(defaultMarkerStoreState));
    });

    it('should return no sections without track state', () => {
        trackStore.set(null);

        expect(detectSongStructure()).toEqual([]);
    });

    it('should return no sections when tracks have no clips', () => {
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-empty', clips: [] })],
            selectedTrackId: null,
            ghostClips: [],
        });

        expect(detectSongStructure()).toEqual([]);
    });

    it('should detect only clips on the target track when a track id is supplied', () => {
        const target_clip = create_clip({
            id: 'clip-target',
            trackId: 'track-target',
            startBeat: 8,
            endBeat: 24,
            type: 'audio',
        });
        const other_clip = create_clip({
            id: 'clip-other',
            trackId: 'track-other',
            startBeat: 64,
            endBeat: 96,
            type: 'audio',
        });

        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'track-target', clips: [target_clip] }),
                TrackDummy.create({ id: 'track-other', clips: [other_clip] }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });

        expect(detectSongStructure('track-target')).toEqual([
            {
                startBeat: 8,
                endBeat: 24,
                name: 'Intro',
                color: 'oklch(0.42 0.10 200)',
                confidence: 0.85,
            },
        ]);
    });

    it('should append detected sections to existing marker store sections', () => {
        const existing_section = {
            id: 'section-existing',
            startBeat: 0,
            endBeat: 4,
            name: 'Count-in',
            color: '#abcdef',
        };
        const marker_state: MarkerStoreState = {
            markers: [],
            sections: [existing_section],
        };
        const source_clip = create_clip({
            id: 'clip-source',
            trackId: 'track-source',
            startBeat: 4,
            endBeat: 20,
            type: 'midi',
        });

        markerStore.set(marker_state);
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-source', kind: 'midi', clips: [source_clip] })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const detected_sections = detectAndApplySongStructure('track-source');

        expect(detected_sections).toEqual([
            {
                startBeat: 4,
                endBeat: 20,
                name: 'Intro',
                color: 'oklch(0.42 0.10 200)',
                confidence: 0.85,
            },
        ]);
        expect(markerStore.value?.sections).toEqual([
            existing_section,
            expect.objectContaining({
                startBeat: 4,
                endBeat: 20,
                name: 'Intro',
                color: 'oklch(0.42 0.10 200)',
            }),
        ]);
    });
});
