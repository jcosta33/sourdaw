import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultTransportState, playheadPositionRef, transportStore } from '#/modules/Transport/stores';

import { type Clip, createTrack } from '../../../models/Track';
import { clipboardStore } from '../../../stores/clipboardStore';
import { defaultTrackState, trackStore } from '../../../stores/trackStore';
import { pasteClip } from '../pasteClip';

/**
 * Paste must reproduce the copied clip, not a default clip over the same file.
 * The clipboard already holds the whole clip (`copySelectedClip` spreads it),
 * but `pasteClip` forwards only its span, name, type, buffer and MIDI offset to
 * `addClip`. A trimmed audio clip therefore pastes playing from the top of the
 * file instead of the trimmed region, at unity gain, without its fades and at
 * its unstretched speed. The control: the placement and the buffer do survive.
 */

const PLAYHEAD_BEAT = 16;

function trimmedVocal(): Clip {
    return {
        id: 'c-vocal',
        trackId: 't-vocal',
        name: 'Verse Vox',
        startBeat: 4,
        endBeat: 12,
        type: 'audio',
        audioBufferId: 'buffer-vocal',
        audioOffsetBeats: 2,
        fadeInBeats: 1,
        fadeOutBeats: 1.5,
        gain: 0.5,
        color: '#00aa00',
        locked: false,
        muted: false,
        stretchMode: 'timestretch',
        stretchRatio: 1.5,
    };
}

function pastedClip(): Clip {
    const pasted = trackStore.value?.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.name === 'Verse Vox (paste)');
    if (!pasted) {
        throw new Error('Expected a pasted clip on the vocal track');
    }
    return pasted;
}

describe('pasteClip reproduces the copied clip', () => {
    let previousPlayhead = 0;

    beforeEach(() => {
        const vocal = createTrack({ id: 't-vocal', name: 'Vocal', kind: 'audio' });
        const source = trimmedVocal();
        trackStore.set({ ...defaultTrackState, tracks: [{ ...vocal, clips: [source] }], selectedTrackId: 't-vocal' });
        transportStore.set(defaultTransportState);
        clipboardStore.set({
            clipClipboard: [{ clip: trimmedVocal(), automationLanes: [], sourceTrackId: 't-vocal' }],
            noteClipboard: null,
        });
        previousPlayhead = playheadPositionRef.current;
        playheadPositionRef.current = PLAYHEAD_BEAT;
    });

    afterEach(() => {
        playheadPositionRef.current = previousPlayhead;
        clipboardStore.set({ clipClipboard: [], noteClipboard: null });
        trackStore.set(structuredClone(defaultTrackState));
    });

    it('control: pastes the copied span at the playhead over the same audio buffer', () => {
        expect(pasteClip()).toBe(true);

        const pasted = pastedClip();
        expect(pasted.startBeat).toBe(PLAYHEAD_BEAT);
        expect(pasted.endBeat).toBe(PLAYHEAD_BEAT + 8);
        expect(pasted.audioBufferId).toBe('buffer-vocal');
    });

    it('keeps the trimmed region of the audio file', () => {
        expect(pasteClip()).toBe(true);

        expect(pastedClip().audioOffsetBeats).toBe(2);
    });

    it('keeps the clip gain, fades and time-stretch', () => {
        expect(pasteClip()).toBe(true);

        const pasted = pastedClip();
        expect.soft(pasted.gain).toBe(0.5);
        expect.soft(pasted.fadeInBeats).toBe(1);
        expect.soft(pasted.fadeOutBeats).toBe(1.5);
        expect.soft(pasted.stretchMode).toBe('timestretch');
        expect.soft(pasted.stretchRatio).toBe(1.5);
    });
});
