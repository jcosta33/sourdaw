import { describe, expect, it } from 'vitest';

import { getFreezeRenderSpan } from '../getFreezeRenderSpan';

describe('getFreezeRenderSpan', () => {
    it('renders the first beat when the track has no clips', () => {
        expect(getFreezeRenderSpan([])).toEqual({ startBeat: 0, endBeat: 1 });
    });

    it('spans the earliest start to the latest end across unsorted clips', () => {
        const clips = [
            { startBeat: 8, endBeat: 12 },
            { startBeat: 2, endBeat: 5 },
            { startBeat: 4, endBeat: 20 },
            { startBeat: 6, endBeat: 7 },
        ];
        expect(getFreezeRenderSpan(clips)).toEqual({ startBeat: 2, endBeat: 20 });
    });
});
