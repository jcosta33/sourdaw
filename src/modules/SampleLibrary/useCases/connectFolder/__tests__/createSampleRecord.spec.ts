import { describe, expect, it } from 'vitest';

import { createSampleRecord } from '../createSampleRecord';

describe('createSampleRecord', () => {
    it('should build deterministic sample fields from the root and relative file path', () => {
        const record = createSampleRecord('root-1', 'Drums/Kicks/Big.Kick.WAV', 'Big.Kick.WAV', 1234);

        expect(record).toEqual({
            favorite: false,
            folder: 'Drums/Kicks',
            format: {},
            id: 'root-1\u0000Drums/Kicks/Big.Kick.WAV',
            libraryRootId: 'root-1',
            relativePath: 'Drums/Kicks/Big.Kick.WAV',
            displayName: 'Big.Kick',
            ext: 'wav',
            sync: {
                exists: true,
                mtimeMs: 1234,
                status: 'discovered',
            },
            tags: [],
        });
    });

    it('should leave folder empty for root-level samples', () => {
        const record = createSampleRecord('root-1', 'snare.aiff', 'snare.aiff');

        expect(record.folder).toBe('');
        expect(record.displayName).toBe('snare');
        expect(record.ext).toBe('aiff');
        expect(record.sync).toEqual({
            exists: true,
            mtimeMs: undefined,
            status: 'discovered',
        });
    });
});
