import { describe, expect, it } from 'vitest';

import { collectAudioBufferIdFields } from '../collectAudioBufferIdFields';

function nestBelow(depth: number, leaf: unknown): unknown {
    let value = leaf;
    for (let level = 0; level < depth; level++) {
        value = { child: value };
    }
    return value;
}

describe('collectAudioBufferIdFields', () => {
    it('reads every buffer-named field, singular or plural, current or legacy', () => {
        const payload = {
            clip: { audioBufferId: 'clip-buffer', name: 'not-a-buffer' },
            track: { frozenBufferId: 'frozen-buffer', freezeState: { frozenBufferId: 'frozen-buffer' } },
            legacyClip: { bufferId: 'legacy-buffer' },
            reverse: { reversedBufferId: 'reversed-buffer' },
            declared: { restoresBufferIds: ['declared-a', 'declared-b'] },
            unrelated: { clipId: 'clip-id', fileId: 'file-id', bufferSize: 512 },
        };

        expect(collectAudioBufferIdFields(payload).toSorted()).toEqual([
            'clip-buffer',
            'declared-a',
            'declared-b',
            'frozen-buffer',
            'legacy-buffer',
            'reversed-buffer',
        ]);
    });

    it('reads codec-encoded entries alongside plain ones', () => {
        const encoded = {
            type: 'object',
            prototype: 'object',
            entries: [
                { key: 'audioBufferId', value: { type: 'string', value: 'encoded-buffer' } },
                { key: 'name', value: { type: 'string', value: 'encoded-name' } },
            ],
        };

        expect(collectAudioBufferIdFields({ plan: encoded })).toEqual(['encoded-buffer']);
    });

    it('finds a buffer however deep the payload nests it', () => {
        expect(collectAudioBufferIdFields(nestBelow(200, { audioBufferId: 'deep-buffer' }))).toEqual(['deep-buffer']);
    });

    it('reads a shared or repeated reference once and skips PCM', () => {
        const clip = { audioBufferId: 'shared-buffer', pcm: new Float32Array(4) };
        expect(collectAudioBufferIdFields({ before: clip, after: clip, list: [clip, clip] })).toEqual([
            'shared-buffer',
        ]);
    });
});
