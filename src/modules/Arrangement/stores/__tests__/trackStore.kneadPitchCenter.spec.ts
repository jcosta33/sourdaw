import { describe, expect, it } from 'vitest';

import { sanitizeTrackSnapshot } from '../trackStore';

/**
 * Regression: a Knead clip's pitch-correction shift is derived from the delta
 * between `pitchCenterCents` (the corrected center) and `originalPitchCenterCents`
 * (the analysed center). The reload-time normalizer rebuilds each blob field by
 * field, so a dropped `originalPitchCenterCents` makes the Knead processor fall
 * back to `pitchCenterCents` (zero delta) and the shift silently resets after a
 * save/reload (or any CRDT sync) — a data loss the user never asked for.
 *
 * `sanitizeTrackSnapshot` is exactly the normalizer that `restoreTrackSnapshot`
 * runs on every project load and that the trackStore's CRDT `fromCrdt` runs on
 * every sync, so this asserts the persisted value survives the round-trip.
 */
describe('trackStore knead blob originalPitchCenterCents persistence', () => {
    it('preserves originalPitchCenterCents through the reload/CRDT sanitize round-trip', () => {
        const persistedSnapshot = {
            tracks: [
                {
                    id: 'track-knead',
                    name: 'Vocals',
                    kind: 'audio',
                    clips: [
                        {
                            id: 'clip-knead',
                            trackId: 'track-knead',
                            name: 'Take',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#ffffff',
                            locked: false,
                            muted: false,
                            kneadState: {
                                blobs: [
                                    {
                                        id: 'blob-1',
                                        startTime: 0,
                                        endTime: 1,
                                        pitchCenterCents: 6200,
                                        originalPitchCenterCents: 6000,
                                        pitchCurveCents: [0, 10, 20],
                                        voicedConfidence: 0.9,
                                    },
                                ],
                                retuneSpeedMs: 25,
                                humanizePercent: 40,
                                formantPreserve: true,
                            },
                        },
                    ],
                },
            ],
            selectedTrackId: null,
        };

        // JSON round-trip mirrors the on-disk/CRDT serialization boundary.
        const restored = sanitizeTrackSnapshot(JSON.parse(JSON.stringify(persistedSnapshot)));
        const blob = restored.tracks[0]?.clips[0]?.kneadState?.blobs[0];

        expect(blob?.pitchCenterCents).toBe(6200);
        expect(blob?.originalPitchCenterCents).toBe(6000);
    });

    it('drops a non-finite originalPitchCenterCents rather than persisting garbage', () => {
        const persistedSnapshot = {
            tracks: [
                {
                    id: 'track-knead',
                    name: 'Vocals',
                    kind: 'audio',
                    clips: [
                        {
                            id: 'clip-knead',
                            trackId: 'track-knead',
                            name: 'Take',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#ffffff',
                            locked: false,
                            muted: false,
                            kneadState: {
                                blobs: [
                                    {
                                        id: 'blob-1',
                                        startTime: 0,
                                        endTime: 1,
                                        pitchCenterCents: 6200,
                                        originalPitchCenterCents: 'nope',
                                        pitchCurveCents: [0, 10, 20],
                                        voicedConfidence: 0.9,
                                    },
                                ],
                                retuneSpeedMs: 25,
                                humanizePercent: 40,
                                formantPreserve: true,
                            },
                        },
                    ],
                },
            ],
            selectedTrackId: null,
        };

        const restored = sanitizeTrackSnapshot(persistedSnapshot);
        const blob = restored.tracks[0]?.clips[0]?.kneadState?.blobs[0];

        expect(blob?.pitchCenterCents).toBe(6200);
        expect(blob?.originalPitchCenterCents).toBeUndefined();
    });
});
