import { describe, it, expect } from 'vitest';

import { getDroppedCrumbsFilePath } from '../get-dropped-crumbs-file-path';

function createFileWithPath(name: string, path: string): File {
    const file = new File([], name);
    Object.defineProperty(file, 'path', { value: path });
    return file;
}

function createFileWithWebkitPath(name: string, webkitRelativePath: string): File {
    const file = new File([], name);
    Object.defineProperty(file, 'webkitRelativePath', { value: webkitRelativePath });
    return file;
}

describe('getDroppedCrumbsFilePath', () => {
    it('should prefer the desktop path attached to a dropped file', () => {
        const file = createFileWithPath('loop.wav', '/Users/me/Loops/loop.wav');

        expect(getDroppedCrumbsFilePath({ file })).toBe('/Users/me/Loops/loop.wav');
    });

    it('should fall back to the webkit relative path when no desktop path exists', () => {
        const file = createFileWithWebkitPath('loop.wav', 'Loops/loop.wav');

        expect(getDroppedCrumbsFilePath({ file })).toBe('Loops/loop.wav');
    });

    it('should fall back to the file name when no richer path exists', () => {
        const file = new File([], 'loop.wav');

        expect(getDroppedCrumbsFilePath({ file })).toBe('loop.wav');
    });
});
