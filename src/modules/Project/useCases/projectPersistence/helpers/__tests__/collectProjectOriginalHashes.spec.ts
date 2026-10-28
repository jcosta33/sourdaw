import { describe, expect, it } from 'vitest';

import {
    collectProjectAllBufferIds,
    collectProjectFreezeOnlyBufferIds,
    collectProjectOriginalHashes,
} from '../collectProjectOriginalHashes';

import type { ProjectClip } from '../../../../models/ProjectData';
import type { HydratableProjectData } from '../isHydratableProjectData';

const clip: ProjectClip = {
    id: 'active-clip',
    trackId: 'active',
    name: 'Active',
    startBeat: 0,
    endBeat: 4,
    type: 'audio',
    bufferId: 'active-pcm',
    assetHash: `sha256:${'1'.repeat(64)}`,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#fff',
    locked: false,
    muted: false,
};

describe('project media reference collection', () => {
    it('retains inactive arrangements, alternate takes, frozen PCM, and shared hashes once', () => {
        const data: HydratableProjectData = {
            version: 1,
            meta: {
                projectId: '00000000-0000-4000-8000-000000000001',
                name: 'References',
                createdAt: 1,
                updatedAt: 1,
                keyRoot: 0,
                scaleName: 'Major',
                tuning: { name: '12-TET', frequencies: [] },
            },
            arrangement: {
                tracks: [
                    {
                        id: 'active',
                        name: 'Active',
                        kind: 'audio',
                        clips: [clip],
                        alternatives: [
                            {
                                id: 'alternate',
                                name: 'Alternate',
                                clips: [
                                    {
                                        ...clip,
                                        id: 'alternate-clip',
                                        bufferId: 'alternate-pcm',
                                        assetHash: `sha256:${'2'.repeat(64)}`,
                                    },
                                ],
                            },
                        ],
                        frozenBufferId: 'frozen-pcm',
                    },
                ],
            },
            arrangements: [
                {
                    id: 'inactive',
                    name: 'Inactive',
                    tracks: {
                        tracks: [
                            {
                                id: 'inactive-track',
                                name: 'Inactive',
                                kind: 'audio',
                                clips: [{ ...clip, id: 'inactive-clip', bufferId: 'inactive-pcm' }],
                            },
                        ],
                        selectedTrackId: null,
                    },
                },
            ],
        };

        expect(collectProjectOriginalHashes(data)).toEqual([clip.assetHash, `sha256:${'2'.repeat(64)}`]);
        expect(collectProjectAllBufferIds(data)).toEqual(['frozen-pcm', 'active-pcm', 'alternate-pcm', 'inactive-pcm']);
        expect(collectProjectFreezeOnlyBufferIds(data)).toEqual(['frozen-pcm']);
    });
});
