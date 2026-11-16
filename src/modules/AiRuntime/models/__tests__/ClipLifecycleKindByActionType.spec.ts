import { describe, expect, it } from 'vitest';

import { clipLifecycleKindByActionType } from '../ClipLifecycleKindByActionType';

describe('clipLifecycleKindByActionType', () => {
    it('lists exactly the clip-consuming and clip-pinning actions', () => {
        const listed = Object.entries(clipLifecycleKindByActionType)
            .filter(([, kind]) => kind !== 'none')
            .map(([type, kind]) => `${type}:${kind}`)
            .toSorted();

        expect(listed).toEqual(['glueClips:glue', 'lockClip:lock', 'removeClip:remove']);
    });
});
