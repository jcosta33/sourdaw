import { describe, expect, it } from 'vitest';

import {
    getAudioSourcePositionSeconds,
    getAudioTimelineElapsedSeconds,
    resolveAudioSourceOffsetSeconds,
    projectAudioLoopPassSegments,
    resolveAudioLoopStartSeconds,
    captureAudioSourceState,
    resolveAudioTakeSource,
} from '../audioSourceTime';

describe('audio take clock admission', () => {
    const clip = { startBeat: 3.3, audioOffsetBeats: 0.1 };
    const timeline = {
        secondsAtBeat: (beat: number) => (beat * 60) / 140,
        beatAtSeconds: (seconds: number) => (seconds * 140) / 60,
        tempoAtBeat: () => 140,
    };

    it.each([{}, { sourceOffsetBeats: 0 }, { sourceOffsetBeats: 0.25 }])(
        'leaves beat-only input to the legacy arithmetic without promoting a read %j',
        (take) => {
            expect(resolveAudioTakeSource(take, clip, timeline)).toBeNull();
        }
    );

    it('keeps canonical clip zero authoritative over legacy clip beats', () => {
        const media = resolveAudioTakeSource({}, { ...clip, audioOffsetSeconds: 0 }, timeline);
        expect(media).not.toBeNull();
        if (!media || 'status' in media) {
            throw new Error('Expected canonical media');
        }
        expect(media.offsetSecondsAt(clip.startBeat)).toBe(0);
    });

    it('keeps canonical take depth zero authoritative over legacy take beats', () => {
        const media = resolveAudioTakeSource(
            { sourceOffsetBeats: 8, sourceOffsetSeconds: 0 },
            { ...clip, audioOffsetSeconds: 0 },
            timeline
        );
        expect(media).not.toBeNull();
        if (!media || 'status' in media) {
            throw new Error('Expected canonical media');
        }
        expect(media.offsetSecondsAt(clip.startBeat)).toBe(0);
    });

    it.each([
        { audioOffsetSeconds: Number.NaN },
        { audioUnwrappedOffsetSeconds: 0 },
        { audioLoopStartSeconds: 0 },
        { audioLoopPassEntrySeconds: 0 },
        { audioLoopPassOriginBeat: 0 },
    ])('does not reinterpret malformed or orphan modern clip fields as legacy %j', (fields) => {
        expect(resolveAudioTakeSource({}, { ...clip, ...fields }, timeline)).toEqual({ status: 'invalid' });
    });

    it.each([{ sourceOffsetSeconds: Number.NaN }, { passOriginBeat: 0 }, { passSourceEndSeconds: 2 }])(
        'does not reinterpret malformed or orphan modern take fields as legacy %j',
        (take) => {
            expect(resolveAudioTakeSource(take, clip, timeline)).toEqual({ status: 'invalid' });
        }
    );

    it('keeps an old placed pass on its existing physical placement algorithm until its basis is captured', () => {
        expect(
            resolveAudioTakeSource({ sourceOffsetBeats: 0, passAnchorSeconds: 1, passDepthSeconds: 2 }, clip, timeline)
        ).toBeNull();
    });

    it('rejects an orphan original pass basis instead of falling back to legacy placed media', () => {
        expect(
            resolveAudioTakeSource(
                { sourceOffsetBeats: 0, passAnchorSeconds: 1, passDepthSeconds: 2, passOriginBeat: 0 },
                clip,
                timeline
            )
        ).toEqual({ status: 'invalid' });
    });
});

describe('resolveAudioSourceOffsetSeconds', () => {
    it('prefers canonical zero over a nonzero legacy offset', () => {
        expect(resolveAudioSourceOffsetSeconds({ audioOffsetSeconds: 0, audioOffsetBeats: 12 }, 90)).toBe(0);
    });

    it('keeps a signed canonical entry independent of the legacy offset and tempo', () => {
        const offset = { audioOffsetSeconds: -2, audioOffsetBeats: 12 };
        expect(resolveAudioSourceOffsetSeconds(offset, 90)).toBe(-2);
        expect(resolveAudioSourceOffsetSeconds(offset, 60)).toBe(-2);
    });

    it.each([
        { tempo: 90, beats: 3, seconds: 2 },
        { tempo: 60, beats: 3, seconds: 3 },
        { tempo: 90, beats: -3, seconds: -2 },
    ])('reads legacy $beats beats at the clip-start tempo $tempo', ({ tempo, beats, seconds }) => {
        expect(resolveAudioSourceOffsetSeconds({ audioOffsetBeats: beats }, tempo)).toBe(seconds);
    });

    it('defaults a missing offset to source sample zero', () => {
        expect(resolveAudioSourceOffsetSeconds({}, 90)).toBe(0);
    });

    it('preserves a finite legacy offset when seconds per beat is one', () => {
        expect(resolveAudioSourceOffsetSeconds({ audioOffsetBeats: Number.MAX_VALUE }, 60)).toBe(Number.MAX_VALUE);
    });

    it.each([0, -60, Number.NaN, Number.POSITIVE_INFINITY])(
        'preserves the legacy no-offset fallback for an invalid clip-start tempo %s',
        (tempo) => {
            expect(resolveAudioSourceOffsetSeconds({ audioOffsetBeats: 3 }, tempo)).toBe(0);
        }
    );
});

describe('audio source and timeline seconds', () => {
    it('retains signed source positions across silent lead-in at double speed', () => {
        expect(getAudioSourcePositionSeconds(-2, 0, 2)).toBe(-2);
        expect(getAudioSourcePositionSeconds(-2, 0.5, 2)).toBe(-1);
        expect(getAudioTimelineElapsedSeconds(-2, 0, 2)).toBe(1);
        expect(getAudioSourcePositionSeconds(-2, 1, 2)).toBe(0);
    });

    it('advances source time over a caller-integrated internal tempo change', () => {
        // Beats 8..14 at 120 BPM take 3 seconds; beats 14..16 at 60 take 2.
        const elapsedTimelineSeconds = 5;
        const sourcePositionSeconds = getAudioSourcePositionSeconds(1.25, elapsedTimelineSeconds, 1.5);
        expect(sourcePositionSeconds).toBe(8.75);
        expect(sourcePositionSeconds - getAudioSourcePositionSeconds(1.25, 0, 1.5)).toBe(7.5);
        expect(getAudioTimelineElapsedSeconds(1.25, sourcePositionSeconds, 1.5)).toBe(5);
    });

    it('preserves a reversed elapsed span rather than clamping it', () => {
        // The same tempo-map interval traversed from beat 16 back to beat 8.
        const sourcePositionSeconds = getAudioSourcePositionSeconds(1.25, -5, 1.5);
        expect(sourcePositionSeconds).toBe(-6.25);
        expect(getAudioTimelineElapsedSeconds(1.25, sourcePositionSeconds, 1.5)).toBe(-5);
    });

    it.each([
        { ratio: 0, sourcePosition: 1.04 },
        { ratio: -2, sourcePosition: 1.04 },
        { ratio: 2, sourcePosition: 9 },
        { ratio: 1000, sourcePosition: 401 },
    ])('uses the shared stretch bound for forward and inverse ratio $ratio', ({ ratio, sourcePosition }) => {
        expect(getAudioSourcePositionSeconds(1, 4, ratio)).toBeCloseTo(sourcePosition, 12);
        expect(getAudioTimelineElapsedSeconds(1, sourcePosition, ratio)).toBeCloseTo(4, 12);
    });
});

describe('canonical loop source boundary', () => {
    it.each([1, 5, 17])('captures the actual legacy repeat head after advance %s', (startBeat) => {
        expect(
            captureAudioSourceState(
                { startBeat, loopOriginBeat: 0, loopEnabled: true, audioOffsetBeats: startBeat },
                4,
                120
            )
        ).toEqual({
            audioOffsetSeconds: 0.5,
            audioUnwrappedOffsetSeconds: startBeat / 2,
            audioLoopStartSeconds: 0,
            audioLoopPassEntrySeconds: 0.5,
            audioLoopPassOriginBeat: startBeat,
        });
    });

    it.each([0, -1, 7])('admits partial canonical entry %s as a fresh source region', (entry) => {
        expect(
            captureAudioSourceState(
                { startBeat: 6, loopOriginBeat: 1, loopEnabled: true, audioOffsetBeats: 99, audioOffsetSeconds: entry },
                4,
                45
            )
        ).toEqual({
            audioOffsetSeconds: entry,
            audioUnwrappedOffsetSeconds: entry,
            audioLoopStartSeconds: entry,
            audioLoopPassEntrySeconds: entry,
            audioLoopPassOriginBeat: 6,
        });
    });

    it.each([
        { audioLoopStartSeconds: 0 },
        { audioLoopPassEntrySeconds: 0 },
        { audioLoopPassOriginBeat: 0 },
        { audioOffsetSeconds: 0, audioLoopPassEntrySeconds: Number.NaN },
        { audioUnwrappedOffsetSeconds: 0 },
        { audioOffsetSeconds: 0, audioUnwrappedOffsetSeconds: Number.POSITIVE_INFINITY },
    ])('refuses orphan or malformed source anchors %j', (fields) => {
        const clip = { startBeat: 0, loopEnabled: true, ...fields };
        expect(captureAudioSourceState(clip, 4, 120)).toBeNull();
        expect(
            projectAudioLoopPassSegments({
                clip,
                loopLengthBeats: 4,
                iterationStartBeat: 0,
                iterationEndBeat: 4,
                stretchRatio: 1,
                tempoAtClipStart: 120,
                secondsAtBeat: (beat) => beat / 2,
            })
        ).toEqual([]);
    });

    it('keeps the original pass head and wrapped reset inside a cut window with three parts', () => {
        const clip = {
            startBeat: 2,
            loopOriginBeat: 0,
            loopEnabled: true,
            audioOffsetSeconds: 1.5,
            audioLoopStartSeconds: 0,
            audioLoopPassEntrySeconds: 0.5,
            audioLoopPassOriginBeat: 1,
        };
        expect(
            projectAudioLoopPassSegments({
                clip,
                loopLengthBeats: 4,
                iterationStartBeat: 2,
                iterationEndBeat: 6,
                stretchRatio: 2,
                tempoAtClipStart: 120,
                secondsAtBeat: (beat) => beat / 2,
            })
        ).toEqual([
            { startOffsetBeats: 0, endOffsetBeats: 2, sourceStartSeconds: 1.5 },
            { startOffsetBeats: 2, endOffsetBeats: 3, sourceStartSeconds: 0 },
            { startOffsetBeats: 3, endOffsetBeats: 4, sourceStartSeconds: 0.5 },
        ]);
    });

    it.each([
        { audioOffsetBeats: 5, loopOriginBeat: 1, sourceHead: 0.5, headEnd: 3 },
        { audioOffsetBeats: 8, loopOriginBeat: -2, sourceHead: 0, headEnd: 4 },
    ])(
        'preserves legacy beat-region phase for offset $audioOffsetBeats across repeated passes',
        ({ audioOffsetBeats, loopOriginBeat, sourceHead, headEnd }) => {
            for (const iterationStartBeat of [6, 10, 14]) {
                const segments = projectAudioLoopPassSegments({
                    clip: { startBeat: 6, audioOffsetBeats, loopOriginBeat, loopEnabled: true },
                    loopLengthBeats: 4,
                    iterationStartBeat,
                    iterationEndBeat: iterationStartBeat + 4,
                    stretchRatio: 1,
                    tempoAtClipStart: 120,
                    secondsAtBeat: (beat) => (beat <= 8 ? beat / 2 : 4 + beat - 8),
                });
                const expected = [{ startOffsetBeats: 0, endOffsetBeats: headEnd, sourceStartSeconds: sourceHead }];
                if (headEnd < 4) {
                    expected.push({ startOffsetBeats: headEnd, endOffsetBeats: 4, sourceStartSeconds: 0 });
                }
                expect(segments).toEqual(expected);
            }
        }
    );

    it('keeps an authoritative unwrapped zero distinct from the audible entry and legacy beats', () => {
        const clip = {
            startBeat: 17,
            loopEnabled: true,
            loopOriginBeat: 0,
            audioOffsetBeats: 17,
            audioOffsetSeconds: 0.5,
            audioUnwrappedOffsetSeconds: 0,
        };
        expect(captureAudioSourceState(clip, 4, 60)).toMatchObject({
            audioOffsetSeconds: 0.5,
            audioUnwrappedOffsetSeconds: 0,
        });
    });

    it.each([0, -1, 7])(
        'keeps authoritative canonical head %s even without a captured loop boundary',
        (audioOffsetSeconds) => {
            expect(
                projectAudioLoopPassSegments({
                    clip: {
                        startBeat: 6,
                        loopOriginBeat: 1,
                        loopEnabled: true,
                        audioOffsetBeats: 5,
                        audioOffsetSeconds,
                    },
                    loopLengthBeats: 4,
                    iterationStartBeat: 6,
                    iterationEndBeat: 10,
                    stretchRatio: 1,
                    tempoAtClipStart: 120,
                    secondsAtBeat: (beat) => beat / 2,
                })[0]?.sourceStartSeconds
            ).toBe(audioOffsetSeconds);
        }
    );

    it('defaults a missing later pass entry to the canonical first entry independently of tempo and rate', () => {
        const clip = {
            startBeat: 4,
            loopOriginBeat: 2,
            loopEnabled: true,
            audioOffsetSeconds: 7,
            audioLoopStartSeconds: 5.5,
        };
        const heads = [4, 8].map(
            (iterationStartBeat) =>
                projectAudioLoopPassSegments({
                    clip,
                    loopLengthBeats: 4,
                    iterationStartBeat,
                    iterationEndBeat: iterationStartBeat + 4,
                    stretchRatio: 1.5,
                    tempoAtClipStart: 60,
                    secondsAtBeat: (beat) => (beat <= 4 ? beat / 2 : beat - 2),
                })[0]?.sourceStartSeconds
        );
        expect(heads).toEqual([7, 7]);
    });

    it.each([0, -1, 5.5])(
        'keeps signed source boundary %s independently of the new placement tempo',
        (audioLoopStartSeconds) => {
            const clip = {
                startBeat: 4,
                loopOriginBeat: 2,
                loopEnabled: true,
                audioOffsetSeconds: 7,
                audioLoopStartSeconds,
            };
            expect(resolveAudioLoopStartSeconds(clip, 120)).toBe(audioLoopStartSeconds);
            expect(resolveAudioLoopStartSeconds(clip, 60)).toBe(audioLoopStartSeconds);
        }
    );
    it('keeps the stored head while the loop boundary is inert with looping off', () => {
        expect(
            projectAudioLoopPassSegments({
                clip: {
                    startBeat: 4,
                    loopOriginBeat: 2,
                    loopEnabled: false,
                    audioOffsetSeconds: -1,
                    audioLoopStartSeconds: 5.5,
                },
                loopLengthBeats: 4,
                iterationStartBeat: 4,
                iterationEndBeat: 8,
                stretchRatio: 1.5,
                tempoAtClipStart: 60,
                secondsAtBeat: (beat) => beat,
            })
        ).toEqual([{ startOffsetBeats: 0, endOffsetBeats: 4, sourceStartSeconds: -1 }]);
    });
});
