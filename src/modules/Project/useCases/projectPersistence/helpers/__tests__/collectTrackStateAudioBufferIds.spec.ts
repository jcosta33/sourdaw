import { describe, expect, it } from 'vitest';

import { collectTrackStateAudioBufferIds } from '../collectTrackStateAudioBufferIds';

describe('collectTrackStateAudioBufferIds', () => {
    it('collects active, frozen, and alternative clip buffers from a CRDT track state', () => {
        expect(
            collectTrackStateAudioBufferIds({
                tracks: [
                    {
                        freezeState: { frozenBufferId: 'frozen' },
                        clips: [{ audioBufferId: 'active' }],
                        alternatives: [{ clips: [{ bufferId: 'alternative' }] }],
                    },
                ],
            })
        ).toEqual(['frozen', 'active', 'alternative']);
    });

    it('ignores malformed track state', () => {
        expect(collectTrackStateAudioBufferIds({ tracks: [null, { clips: 'invalid' }] })).toEqual([]);
    });
});
