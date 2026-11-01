import { from, load, save } from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

import { projectAudioSourcePrefixTracks } from '../projectAudioSourcePrefixTracks';
import { sanitizeTrackSnapshot } from '../trackStore';

function slot(zero = -0) {
    const clip = {
        id: 'clip',
        trackId: 'audio',
        name: 'Audio',
        type: 'audio',
        startBeat: zero,
        endBeat: 8,
        audioOffsetBeats: zero,
        audioOffsetSeconds: zero,
        audioUnwrappedOffsetSeconds: zero,
        audioLoopStartSeconds: zero,
        audioLoopPassEntrySeconds: zero,
        audioLoopPassOriginBeat: zero,
        midiOffsetBeats: zero,
        fadeInBeats: zero,
        fadeOutBeats: zero,
        gain: zero,
        color: 'blue',
        locked: false,
        muted: false,
        stretchRatio: 1,
        loopLength: 4,
        loopOriginBeat: zero,
        sourceKeyRoot: zero,
        kneadState: {
            retuneSpeedMs: zero,
            humanizePercent: zero,
            formantPreserve: true,
            blobs: [
                {
                    id: 'blob',
                    startTime: zero,
                    endTime: 1,
                    pitchCenterCents: zero,
                    originalPitchCenterCents: zero,
                    pitchCurveCents: [zero, 13],
                    voicedConfidence: zero,
                },
            ],
        },
    };
    return {
        tracks: [
            {
                id: 'audio',
                name: 'Track',
                kind: 'audio',
                activeAlternativeId: 'active',
                clips: [clip],
                alternatives: [
                    { id: 'inactive', name: 'Inactive', clips: [{ ...clip, id: 'inactive-clip' }] },
                    { id: 'active', name: 'Active', clips: [] },
                ],
            },
        ],
    };
}

describe('source-prefix track projection', () => {
    it('matches the old clip representation for plain, from-created and binary-loaded documents', () => {
        const plain = slot();
        const raw = from({ tracks: plain });
        const loaded = load<{ tracks: ReturnType<typeof slot> }>(save(raw));
        const oldRepresentation = sanitizeTrackSnapshot(slot(0)).tracks;
        // This producer retains signed zero; change() is not an equivalent producer.
        expect(Object.is(loaded.tracks.tracks[0]?.clips[0]?.startBeat, -0)).toBe(true);
        for (const input of [plain, raw.tracks, loaded.tracks]) {
            const projected = projectAudioSourcePrefixTracks(input);
            expect(projected).toStrictEqual(oldRepresentation);
            expect(Object.is(projected[0]?.clips[0]?.startBeat, -0)).toBe(false);
            expect(Object.is(projected[0]?.alternatives[0]?.clips[0]?.audioOffsetSeconds, -0)).toBe(false);
            expect(Object.is(projected[0]?.clips[0]?.kneadState?.blobs[0]?.pitchCurveCents[0], -0)).toBe(false);
            expect(() => structuredClone(projected)).not.toThrow();
        }
    });

    it('materializes a private knead curve without changing the raw source', () => {
        const raw = from({ tracks: slot() });
        const projected = projectAudioSourcePrefixTracks(raw.tracks);
        const curve = projected[0]?.clips[0]?.kneadState?.blobs[0]?.pitchCurveCents;
        if (!curve) {
            throw new Error('Expected projected knead curve');
        }
        curve[0] = 99;
        expect(Object.is(raw.tracks.tracks[0]?.clips[0]?.kneadState.blobs[0]?.pitchCurveCents[0], -0)).toBe(true);
    });

    it('keeps decoder defaults, clip order and missing optional fields rather than adding undefined fields', () => {
        const plain = {
            tracks: [
                {
                    id: 'audio',
                    kind: 'audio',
                    clips: [
                        {
                            id: 'second',
                            trackId: 'audio',
                            name: 'Second',
                            type: 'midi',
                            startBeat: 4,
                            endBeat: 8,
                            audioOffsetSeconds: undefined,
                            kneadState: undefined,
                        },
                        { id: 'first', trackId: 'audio', name: 'First', type: 'audio', startBeat: 0, endBeat: 4 },
                    ],
                },
            ],
        };
        const projected = projectAudioSourcePrefixTracks(plain);
        expect(projected).toStrictEqual(sanitizeTrackSnapshot(plain).tracks);
        expect(projected[0]?.clips.map((clip) => clip.id)).toEqual(['second', 'first']);
        expect(Object.hasOwn(projected[0]!.clips[0]!, 'audioOffsetSeconds')).toBe(false);
        expect(Object.hasOwn(projected[0]!.clips[0]!, 'kneadState')).toBe(false);
        expect(projectAudioSourcePrefixTracks({ tracks: [] })).toEqual([]);
        expect(projectAudioSourcePrefixTracks(undefined)).toEqual([]);
    });
});
