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

describe('detectSongStructure — section classification', () => {
    // Helper: lay out clips on one midi track spanning the given (start,end) beat
    // ranges, then run detection across all audio/midi tracks.
    function detectForRanges(ranges: Array<{ start: number; end: number }>): string[] {
        const clips = ranges.map((r, i) =>
            create_clip({ id: `c${i}`, trackId: 't', startBeat: r.start, endBeat: r.end, type: 'midi' })
        );
        trackStore.set({
            tracks: [TrackDummy.create({ id: 't', kind: 'midi', clips })],
            selectedTrackId: null,
            ghostClips: [],
        });
        return detectSongStructure().map((s) => s.name);
    }

    it('classifies the last segment past 85% progress as Outro', () => {
        // A long sparse tail: dense intro block then a lone clip near the end.
        // Build an arrangement whose final segment starts beyond 0.85 progress.
        const names = detectForRanges([
            { start: 0, end: 80 }, // dense early block (Intro + body)
            { start: 600, end: 700 }, // sparse tail → final segment, progress ~0.85+
        ]);
        expect(names[names.length - 1]).toBe('Outro');
    });

    it('classifies a high-energy segment in the second half as Drop', () => {
        // Low-energy start, then a dense high-energy block past the midpoint.
        const names = detectForRanges([
            { start: 0, end: 16 }, // sparse intro
            { start: 64, end: 80 }, // dense mid-low
            // many overlapping clips later → high energy past 0.5
            { start: 96, end: 160 },
            { start: 96, end: 160 },
            { start: 96, end: 160 },
            { start: 96, end: 160 },
        ]);
        expect(names).toContain('Drop');
    });

    it('classifies a low-energy segment as Break', () => {
        // Dense sections flanking a sparse middle gap.
        const names = detectForRanges([
            { start: 0, end: 32 },
            { start: 0, end: 32 },
            { start: 0, end: 32 },
            { start: 48, end: 64 }, // sparse middle → Break
            { start: 96, end: 128 },
            { start: 96, end: 128 },
            { start: 96, end: 128 },
        ]);
        expect(names).toContain('Break');
    });

    it('assigns the documented confidence per classification (Intro=0.85, Outro=0.8)', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 't',
                    kind: 'midi',
                    clips: [
                        create_clip({ id: 'c0', trackId: 't', startBeat: 0, endBeat: 80, type: 'midi' }),
                        create_clip({ id: 'c1', trackId: 't', startBeat: 600, endBeat: 700, type: 'midi' }),
                    ],
                }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        const sections = detectSongStructure();
        const intro = sections.find((s) => s.name === 'Intro');
        const outro = sections.find((s) => s.name === 'Outro');
        expect(intro?.confidence).toBe(0.85);
        expect(outro?.confidence).toBe(0.8);
    });

    it('clamps each section endBeat to the global maxBeat', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 't',
                    kind: 'midi',
                    clips: [create_clip({ id: 'c0', trackId: 't', startBeat: 0, endBeat: 20, type: 'midi' })],
                }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        const sections = detectSongStructure();
        // the last section's endBeat must not exceed the clip's maxBeat (20)
        const last = sections[sections.length - 1]!;
        expect(last.endBeat).toBeLessThanOrEqual(20);
    });
});

describe('detectSongStructure — all-tracks vs single-track gathering', () => {
    it('gathers clips from audio and midi tracks when no trackId is given', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'a',
                    kind: 'audio',
                    clips: [create_clip({ id: 'ca', trackId: 'a', startBeat: 0, endBeat: 16, type: 'audio' })],
                }),
                TrackDummy.create({
                    id: 'm',
                    kind: 'midi',
                    clips: [create_clip({ id: 'cm', trackId: 'm', startBeat: 32, endBeat: 48, type: 'midi' })],
                }),
                // folder + master tracks are ignored by the all-tracks filter
                TrackDummy.create({ id: 'f', kind: 'folder', clips: [] }),
                TrackDummy.create({ id: 'master', kind: 'master', clips: [] }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        const sections = detectSongStructure();
        // both audio + midi clips contributed → a section spanning the combined range
        expect(sections.length).toBeGreaterThanOrEqual(1);
        expect(sections[0]!.startBeat).toBe(0);
    });

    it('returns [] when the gathered clips have zero total range', () => {
        // a clip where endBeat === startBeat → totalBeats 0 → early return
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 't',
                    kind: 'midi',
                    clips: [create_clip({ id: 'c', trackId: 't', startBeat: 8, endBeat: 8, type: 'midi' })],
                }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        expect(detectSongStructure()).toEqual([]);
    });
});
