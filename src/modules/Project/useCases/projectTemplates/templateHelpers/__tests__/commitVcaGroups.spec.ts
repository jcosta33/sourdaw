import { describe, expect, it, vi } from 'vitest';

const arrangementMocks = vi.hoisted(() => ({
    commitLegacyVcaTemplateState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    commitLegacyVcaTemplateState: arrangementMocks.commitLegacyVcaTemplateState,
}));

import { commitVcaGroups } from '../commitVcaGroups';

describe('commitVcaGroups', () => {
    it('forwards template state to the Arrangement-owned legacy boundary', () => {
        const tracks: [] = [];
        const handles = [
            {
                id: 'vca-1',
                name: 'Drums',
                memberTrackIds: ['track-1'],
                color: '#123456',
                gain: 0.75,
                muted: true,
                soloed: false,
            },
        ];

        commitVcaGroups({ handles, tracks, selectedTrackId: 'track-1' });

        expect(arrangementMocks.commitLegacyVcaTemplateState).toHaveBeenCalledWith({
            tracks,
            selectedTrackId: 'track-1',
            groups: [
                {
                    id: 'vca-1',
                    name: 'Drums',
                    gain: 0.75,
                    muted: true,
                    memberTrackIds: ['track-1'],
                },
            ],
        });
    });
});
