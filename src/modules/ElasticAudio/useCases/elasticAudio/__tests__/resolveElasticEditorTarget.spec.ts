import { describe, expect, it } from 'vitest';

import { resolveElasticEditorTarget } from '../resolveElasticEditorTarget';

const audio = { id: 'audio', type: 'audio', audioBufferId: 'buffer' };
const midi = { id: 'midi', type: 'midi' };
const arrangement = { tracks: [{ id: 'track', clips: [audio, midi] }] };

describe('resolveElasticEditorTarget', () => {
    it.each([
        [null, 'audio', 'audio', audio],
        ['audio', 'midi', 'audio', audio],
        ['midi', 'audio', 'midi', midi],
        ['missing', 'audio', 'missing', null],
        [null, 'midi', 'midi', midi],
        [null, 'missing', 'missing', null],
        [null, null, null, null],
    ] as const)(
        'resolves opened %s and selected %s without falling through',
        (openClipId, selectedClipId, id, clip) => {
            const target = resolveElasticEditorTarget({ openClipId }, { selectedClipId }, arrangement);
            expect(target).toEqual({ clipId: id, trackId: clip ? 'track' : null, clip });
            if (clip) expect(target.clip).toBe(clip);
        }
    );

    it('uses the singular selected clip and leaves the supplied snapshots untouched', () => {
        const editor = Object.freeze({ openClipId: null });
        const selection = Object.freeze({ selectedClipId: 'audio', selectedClipIds: ['midi'] });
        const before = structuredClone(arrangement);
        expect(resolveElasticEditorTarget(editor, selection, arrangement).clip).toBe(audio);
        expect(arrangement).toEqual(before);
    });
});
