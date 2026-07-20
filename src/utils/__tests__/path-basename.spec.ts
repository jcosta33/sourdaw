import { describe, it, expect } from 'vitest';

import { basename_from_path } from '../path-basename';

describe('basename_from_path', () => {
    it('should return the final segment of a POSIX path', () => {
        expect(basename_from_path('/a/b/c.txt')).toBe('c.txt');
    });

    it('should return the final segment of a Windows path', () => {
        expect(basename_from_path('C:\\a\\b\\c.txt')).toBe('c.txt');
    });

    it('should ignore a single trailing slash', () => {
        expect(basename_from_path('/a/b/')).toBe('b');
    });

    it('should ignore repeated trailing separators', () => {
        expect(basename_from_path('/a/b///')).toBe('b');
    });

    it('should return a bare filename unchanged', () => {
        expect(basename_from_path('file.txt')).toBe('file.txt');
    });

    it('should return the original path when nothing but separators remain', () => {
        // Trimming and splitting "/" yields an empty final segment, so the
        // function falls back to the original, un-trimmed path.
        expect(basename_from_path('/')).toBe('/');
    });

    it('should return an empty string for an empty path', () => {
        expect(basename_from_path('')).toBe('');
    });
});
