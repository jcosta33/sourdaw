import { describe, expect, it } from 'vitest';

import { isAudioFile } from '../LibraryTypes';

describe('isAudioFile', () => {
    it('accepts common lossy and lossless extensions', () => {
        expect(isAudioFile('kick.wav')).toBe(true);
        expect(isAudioFile('loop.WAV')).toBe(true);
        expect(isAudioFile('mix.flac')).toBe(true);
        expect(isAudioFile('stem.aif')).toBe(true);
        expect(isAudioFile('clip.m4a')).toBe(true);
    });

    it('accepts compressed web-friendly formats', () => {
        expect(isAudioFile('x.opus')).toBe(true);
        expect(isAudioFile('y.webm')).toBe(true);
        expect(isAudioFile('z.aac')).toBe(true);
    });

    it('rejects non-audio files', () => {
        expect(isAudioFile('readme.txt')).toBe(false);
        expect(isAudioFile('image.png')).toBe(false);
        expect(isAudioFile('noextension')).toBe(false);
    });

    it('uses the last path segment extension for dotted names', () => {
        expect(isAudioFile('my.file.final.wav')).toBe(true);
        expect(isAudioFile('archive.tar.gz')).toBe(false);
    });
});
