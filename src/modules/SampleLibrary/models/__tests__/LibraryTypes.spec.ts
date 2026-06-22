import { describe, expect, it } from 'vitest';

import {
    isAudioFile,
    isBrowserDecodeRisky,
    isRootReady,
    makeMusicalKey,
    parseMusicalKey,
    toBpm,
} from '../LibraryTypes';

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

describe('toBpm', () => {
    it('accepts a sane tempo unchanged', () => {
        expect(toBpm(120)).toBe(120);
        expect(toBpm(20)).toBe(20);
        expect(toBpm(400)).toBe(400);
    });

    it('rejects non-positive, non-finite, and out-of-range tempos', () => {
        expect(toBpm(-120)).toBeUndefined();
        expect(toBpm(0)).toBeUndefined();
        expect(toBpm(19)).toBeUndefined();
        expect(toBpm(401)).toBeUndefined();
        expect(toBpm(Number.NaN)).toBeUndefined();
        expect(toBpm(Number.POSITIVE_INFINITY)).toBeUndefined();
    });
});

describe('makeMusicalKey', () => {
    it('appends m only for minor keys', () => {
        expect(makeMusicalKey('C', 'major')).toBe('C');
        expect(makeMusicalKey('C#', 'minor')).toBe('C#m');
        expect(makeMusicalKey('A', 'minor')).toBe('Am');
    });
});

describe('parseMusicalKey', () => {
    it('normalizes the casing and minor suffix into a canonical label', () => {
        expect(parseMusicalKey('c')).toBe('C');
        expect(parseMusicalKey('c#m')).toBe('C#m');
        expect(parseMusicalKey('  Am  ')).toBe('Am');
        // A naked major and an explicit minor of the same pitch never collide.
        expect(parseMusicalKey('C#')).toBe('C#');
        expect(parseMusicalKey('C#M')).toBe('C#m');
    });

    it('rejects roots that are not one of the twelve pitch classes', () => {
        expect(parseMusicalKey('banana')).toBeUndefined();
        expect(parseMusicalKey('H')).toBeUndefined();
        expect(parseMusicalKey('')).toBeUndefined();
    });
});

describe('isBrowserDecodeRisky', () => {
    it('flags extensions browsers commonly cannot decode, case-insensitively', () => {
        expect(isBrowserDecodeRisky('aiff')).toBe(true);
        expect(isBrowserDecodeRisky('AIF')).toBe(true);
        expect(isBrowserDecodeRisky('flac')).toBe(true);
        expect(isBrowserDecodeRisky('m4a')).toBe(true);
        expect(isBrowserDecodeRisky('aac')).toBe(true);
    });

    it('does not flag widely decodable formats', () => {
        expect(isBrowserDecodeRisky('wav')).toBe(false);
        expect(isBrowserDecodeRisky('mp3')).toBe(false);
        expect(isBrowserDecodeRisky('ogg')).toBe(false);
        expect(isBrowserDecodeRisky('factory')).toBe(false);
    });
});

describe('isRootReady', () => {
    it('is true only for a ready root', () => {
        expect(isRootReady({ status: 'ready' })).toBe(true);
        expect(isRootReady({ status: 'offline' })).toBe(false);
        expect(isRootReady({ status: 'permission_required' })).toBe(false);
        expect(isRootReady({ status: 'path_missing' })).toBe(false);
        expect(isRootReady({ status: 'scanning' })).toBe(false);
    });
});
