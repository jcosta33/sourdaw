import { describe, expect, it } from 'vitest';

import { normalizeTrack } from '#/modules/Arrangement/useCases';

import { hydrateArrangementTracks } from '../hydrateArrangementTracks';
import { serializeArrangementTracks } from '../serializeArrangementTracks';

/**
 * A Knead clip's pitch shift is the delta between the corrected `pitchCenterCents`
 * and the analysed `originalPitchCenterCents`. If the persisted clip-knead schema
 * omits `originalPitchCenterCents`, a save/reload round-trip drops it and the
 * shift resets to zero. This asserts the field survives serialize → on-disk JSON
 * → hydrate.
 */
describe('knead state persistence round-trip', () => {
    it('preserves originalPitchCenterCents through serialize → JSON → hydrate', () => {
        const track = normalizeTrack({
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
        });

        const serialized = serializeArrangementTracks([track]);
        const serializedBlob = serialized[0]?.clips[0]?.kneadState?.blobs[0];
        expect(serializedBlob?.originalPitchCenterCents).toBe(6000);

        // Deep clone mirrors the on-disk `.sourdaw` write/read boundary — a
        // hydrated blob must carry its own copy of the persisted value.
        const onDisk = structuredClone(serialized);
        const hydrated = hydrateArrangementTracks(onDisk);
        const hydratedBlob = hydrated[0]?.clips[0]?.kneadState?.blobs[0];

        expect(hydratedBlob?.pitchCenterCents).toBe(6200);
        expect(hydratedBlob?.originalPitchCenterCents).toBe(6000);
    });
});
