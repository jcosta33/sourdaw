import { from, load, save } from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

import { projectAudioSourcePrefixTracks } from '../projectAudioSourcePrefixTracks';
import { sanitizeTrackSnapshot } from '../trackStore';

function slot() {
    const clip = {
        id: 'clip',
        trackId: 'audio',
        name: 'Audio',
        type: 'audio',
        startBeat: -0,
        endBeat: 8,
        audioOffsetBeats: -0,
        audioOffsetSeconds: -0,
        audioUnwrappedOffsetSeconds: -0,
        audioLoopStartSeconds: -0,
        audioLoopPassEntrySeconds: -0,
        audioLoopPassOriginBeat: -0,
        midiOffsetBeats: -0,
        fadeInBeats: -0,
        fadeOutBeats: -0,
        gain: -0,
        color: 'blue',
        locked: false,
        muted: false,
        stretchRatio: 1,
        loopLength: 4,
        loopOriginBeat: -0,
        sourceKeyRoot: -0,
        kneadState: {
            retuneSpeedMs: -0,
            humanizePercent: -0,
            formantPreserve: true,
            blobs: [
                {
                    id: 'blob',
                    startTime: -0,
                    endTime: 1,
                    pitchCenterCents: -0,
                    originalPitchCenterCents: -0,
                    pitchCurveCents: [-0, 13],
                    voicedConfidence: -0,
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

function oldPrefix(value: unknown) {
    return sanitizeTrackSnapshot(JSON.parse(JSON.stringify(value))).tracks;
}

describe('source-prefix track projection', () => {
    it('matches the old clip representation for plain, from-created and binary-loaded documents', () => {
        const plain = slot();
        const raw = from({ tracks: plain });
        const loaded = load<{ tracks: ReturnType<typeof slot> }>(save(raw));
        // This producer retains signed zero; change() is not an equivalent producer.
        expect(Object.is(loaded.tracks.tracks[0]?.clips[0]?.startBeat, -0)).toBe(true);
        for (const input of [plain, raw.tracks, loaded.tracks]) {
            const projected = projectAudioSourcePrefixTracks(input);
            expect(projected).toStrictEqual(oldPrefix(input));
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
        if (!curve) throw new Error('Expected projected knead curve');
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
        expect(projected).toStrictEqual(oldPrefix(plain));
        expect(projected[0]?.clips.map((clip) => clip.id)).toEqual(['second', 'first']);
        expect(Object.hasOwn(projected[0]!.clips[0]!, 'audioOffsetSeconds')).toBe(false);
        expect(Object.hasOwn(projected[0]!.clips[0]!, 'kneadState')).toBe(false);
        expect(projectAudioSourcePrefixTracks({ tracks: [] })).toEqual([]);
        expect(projectAudioSourcePrefixTracks(undefined)).toEqual([]);
    });
});
