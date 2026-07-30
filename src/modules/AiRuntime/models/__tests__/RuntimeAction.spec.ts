import { describe, expect, it } from 'vitest';

import { RUNTIME_ACTION_TYPES, type RuntimeAction } from '../RuntimeAction';

describe('RuntimeAction', () => {
    it('admits the exact duplicate-free compatibility action census', () => {
        expect(RUNTIME_ACTION_TYPES).toHaveLength(234);
        expect(new Set(RUNTIME_ACTION_TYPES).size).toBe(RUNTIME_ACTION_TYPES.length);
    });

    it('inherits canonical AppAction replay and identity fields', () => {
        const actions: RuntimeAction[] = [
            { type: 'duplicateClip', payload: { clipId: 'clip-1', targetClipId: 'clip-copy' } },
            {
                type: 'addAutomationLane',
                payload: {
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    laneId: 'lane-1',
                },
            },
            { type: 'createCollabSession', payload: {} },
        ];

        expect(actions).toEqual([
            { type: 'duplicateClip', payload: { clipId: 'clip-1', targetClipId: 'clip-copy' } },
            {
                type: 'addAutomationLane',
                payload: {
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    laneId: 'lane-1',
                },
            },
            { type: 'createCollabSession', payload: {} },
        ]);
    });
});
