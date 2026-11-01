import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { captureClipAudioSource, isSameClipAudioSource, replaceClipAudioSource } from '../ClipAudioSource';

// Every field distinct from the entry and from each other; the pass origin is
// off the clip start, so no field equals a default a reader would derive.
const fullClock = {
    audioOffsetSeconds: 2,
    audioUnwrappedOffsetSeconds: 1.5,
    audioLoopStartSeconds: 0.5,
    audioLoopPassEntrySeconds: 1,
    audioLoopPassOriginBeat: 3,
};
const provenanceFields = [
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
] as const;
const clockFields = ['audioOffsetSeconds', ...provenanceFields] as const;

describe('captureClipAudioSource', () => {
    it('captures every canonical field a clip carries', () => {
        const clip = ClipDummy.create({ startBeat: 4, endBeat: 8, ...fullClock });

        expect(captureClipAudioSource(clip)).toEqual(fullClock);
    });

    it.each(provenanceFields)('leaves %s out when the clip lacks it', (field) => {
        const { [field]: _absent, ...partial } = fullClock;

        const captured = captureClipAudioSource(ClipDummy.create(partial));

        expect(captured).toEqual(partial);
        expect(Object.hasOwn(captured!, field)).toBe(false);
    });

    it('captures nothing from a beat-only clip', () => {
        expect(captureClipAudioSource(ClipDummy.create({ audioOffsetBeats: 2 }))).toBeUndefined();
    });
});

describe('replaceClipAudioSource', () => {
    it.each(provenanceFields)('restores %s absent when the capture lacks it', (field) => {
        const live = ClipDummy.create({ startBeat: 4, endBeat: 8, ...fullClock, audioOffsetSeconds: 9 });
        const { [field]: _absent, ...capture } = fullClock;

        const restored = replaceClipAudioSource(live, capture);

        expect(restored).not.toBeNull();
        expect(Object.hasOwn(restored!, field)).toBe(false);
        expect(captureClipAudioSource(restored!)).toEqual(capture);
    });

    it('refuses provenance without an entry', () => {
        const { audioOffsetSeconds: _entry, ...orphaned } = fullClock;

        expect(replaceClipAudioSource(ClipDummy.create(fullClock), orphaned)).toBeNull();
    });
});

describe('isSameClipAudioSource', () => {
    it.each(clockFields)('tells two clocks apart that differ only in %s', (field) => {
        expect(isSameClipAudioSource(fullClock, { ...fullClock, [field]: fullClock[field] + 0.25 })).toBe(false);
    });

    it.each(clockFields)('tells two clocks apart when only one names %s', (field) => {
        const { [field]: _absent, ...partial } = fullClock;

        expect(isSameClipAudioSource(fullClock, partial)).toBe(false);
    });

    it('matches equal clocks', () => {
        expect(isSameClipAudioSource(fullClock, structuredClone(fullClock))).toBe(true);
    });
});
