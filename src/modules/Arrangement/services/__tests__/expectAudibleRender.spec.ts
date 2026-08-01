import { describe, it, expect } from 'vitest';

import { type Clip } from '../../models/Track';
import { expectAudibleRender, type ExpectAudibleRenderInput } from '../expectAudibleRender';

function makeClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'clip-1',
        trackId: 't1',
        name: 'Verse',
        startBeat: 0,
        endBeat: 8,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function evaluate(overrides: Partial<ExpectAudibleRenderInput> = {}) {
    return expectAudibleRender({
        clips: [makeClip()],
        startBeat: 0,
        endBeat: 8,
        silencedInMix: false,
        bakedFaderGain: 1,
        hasMidiNotes: () => true,
        hasAudioSamples: () => true,
        ...overrides,
    });
}

describe('expectAudibleRender', () => {
    it('expects audio from an unmuted track whose MIDI clip carries notes', () => {
        expect(evaluate()).toEqual({ expectsAudio: true });
    });

    it('expects audio from an audio clip whose samples resolve', () => {
        expect(evaluate({ clips: [makeClip({ type: 'audio', audioBufferId: 'buf-1' })] })).toEqual({
            expectsAudio: true,
        });
    });

    // ── Legitimate silence: the render was supposed to be quiet ─────────────

    it('excuses a track the mix has silenced (its own mute, or another track’s solo)', () => {
        expect(evaluate({ silencedInMix: true })).toEqual({
            expectsAudio: false,
            reason: 'silenced-in-mix',
        });
    });

    it('excuses a fader the user pulled to zero in a render that bakes it', () => {
        expect(evaluate({ bakedFaderGain: 0 })).toEqual({ expectsAudio: false, reason: 'fader-zeroed' });
    });

    it('excuses an empty track', () => {
        expect(evaluate({ clips: [] })).toEqual({ expectsAudio: false, reason: 'no-audible-clip-content' });
    });

    it('excuses clips that end before the rendered range begins', () => {
        expect(evaluate({ startBeat: 16, endBeat: 24 })).toEqual({
            expectsAudio: false,
            reason: 'no-audible-clip-content',
        });
    });

    it('excuses clips that begin after the rendered range ends', () => {
        expect(evaluate({ clips: [makeClip({ startBeat: 32, endBeat: 40 })] })).toEqual({
            expectsAudio: false,
            reason: 'no-audible-clip-content',
        });
    });

    it('excuses a track whose every clip is muted', () => {
        expect(evaluate({ clips: [makeClip({ muted: true }), makeClip({ id: 'clip-2', muted: true })] })).toEqual({
            expectsAudio: false,
            reason: 'no-audible-clip-content',
        });
    });

    it('excuses a MIDI clip with no notes', () => {
        expect(evaluate({ hasMidiNotes: () => false })).toEqual({
            expectsAudio: false,
            reason: 'no-audible-clip-content',
        });
    });

    it('excuses an audio clip whose sample data cannot be resolved', () => {
        expect(
            evaluate({ clips: [makeClip({ type: 'audio', audioBufferId: 'buf-1' })], hasAudioSamples: () => false })
        ).toEqual({ expectsAudio: false, reason: 'no-audible-clip-content' });
    });

    it('excuses an audio clip the user set to zero gain', () => {
        expect(evaluate({ clips: [makeClip({ type: 'audio', audioBufferId: 'buf-1', gain: 0 })] })).toEqual({
            expectsAudio: false,
            reason: 'no-audible-clip-content',
        });
    });

    it('excuses a clip of zero or negative length', () => {
        expect(evaluate({ clips: [makeClip({ startBeat: 4, endBeat: 4 })] })).toEqual({
            expectsAudio: false,
            reason: 'no-audible-clip-content',
        });
    });

    // ── Precision: an excuse must not spill onto a neighbouring case ────────

    it('still expects audio when one clip of several contributes', () => {
        expect(
            evaluate({ clips: [makeClip({ muted: true }), makeClip({ id: 'clip-2', startBeat: 4, endBeat: 8 })] })
        ).toEqual({ expectsAudio: true });
    });

    it('does not let a zero clip gain excuse a MIDI clip, whose gain the scheduler never reads', () => {
        expect(evaluate({ clips: [makeClip({ gain: 0 })] })).toEqual({ expectsAudio: true });
    });
});
