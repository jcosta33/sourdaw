import { describe, expect, it } from 'vitest';

import { hasExactAudioSourceFields } from '../hasExactAudioSourceFields';

describe('raw audio source field presence', () => {
    it('keeps absent legacy fields and signed canonical entries valid', () => {
        expect(hasExactAudioSourceFields({ type: 'audio', audioOffsetBeats: 7 })).toBe(true);
        expect(
            hasExactAudioSourceFields({ type: 'audio', audioOffsetSeconds: -1, audioUnwrappedOffsetSeconds: -2 })
        ).toBe(true);
    });

    it.each([
        'audioOffsetSeconds',
        'audioUnwrappedOffsetSeconds',
        'audioLoopStartSeconds',
        'audioLoopPassEntrySeconds',
        'audioLoopPassOriginBeat',
    ])('refuses present malformed %s before legacy decoding', (field) => {
        for (const value of [undefined, null, '0', NaN, Infinity]) {
            expect(hasExactAudioSourceFields({ type: 'audio', audioOffsetSeconds: 0, [field]: value })).toBe(false);
        }
    });

    it('refuses orphan anchors and modern audio data on MIDI', () => {
        expect(hasExactAudioSourceFields({ type: 'audio', audioLoopStartSeconds: 0 })).toBe(false);
        expect(hasExactAudioSourceFields({ type: 'midi', audioOffsetSeconds: 0 })).toBe(false);
    });
});
