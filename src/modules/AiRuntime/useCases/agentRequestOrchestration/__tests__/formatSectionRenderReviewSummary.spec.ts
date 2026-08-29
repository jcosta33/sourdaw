import { describe, expect, it } from 'vitest';

import { formatSectionRenderReviewSummary } from '../formatSectionRenderReviewSummary';

describe('formatSectionRenderReviewSummary', () => {
    it('preserves every warning attached to each retained render artifact', () => {
        expect(
            formatSectionRenderReviewSummary([
                { jobId: 'render-verse', warnings: ['tail truncated', 'peak clipped'] },
                { jobId: 'render-chorus', warnings: ['room channel unavailable'] },
            ])
        ).toBe('render-verse (tail truncated; peak clipped), render-chorus (room channel unavailable)');
    });
});
