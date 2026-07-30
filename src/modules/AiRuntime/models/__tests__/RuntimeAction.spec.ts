import { describe, expect, expectTypeOf, it } from 'vitest';

import { RUNTIME_ACTION_TYPES, type RuntimeAction } from '../RuntimeAction';

type RuntimePayload<ActionType extends RuntimeAction['type']> =
    Extract<RuntimeAction, { type: ActionType }> extends { payload: infer Payload } ? Payload : never;
type PayloadHasKey<
    ActionType extends RuntimeAction['type'],
    Key extends PropertyKey,
> = Key extends keyof RuntimePayload<ActionType> ? true : false;

describe('RuntimeAction', () => {
    it('admits the exact duplicate-free compatibility action census', () => {
        expect(RUNTIME_ACTION_TYPES).toHaveLength(234);
        expect(new Set(RUNTIME_ACTION_TYPES).size).toBe(RUNTIME_ACTION_TYPES.length);
    });

    it('derives initiating payloads without exposing command-owned replay fields', () => {
        type EmptyCollabSessionPayloadAllowed = {} extends RuntimePayload<'createCollabSession'> ? true : false;
        const actions: RuntimeAction[] = [
            { type: 'duplicateClip', payload: { clipId: 'clip-1' } },
            {
                type: 'addAutomationLane',
                payload: { trackId: 'track-1', parameterId: 'gain', parameterName: 'Gain' },
            },
            { type: 'createVcaGroup', payload: { name: 'Band', trackIds: ['track-1'] } },
            { type: 'createCollabSession', payload: { name: 'Mix review' } },
        ];

        expect(actions.map((action) => action.type)).toEqual([
            'duplicateClip',
            'addAutomationLane',
            'createVcaGroup',
            'createCollabSession',
        ]);
        expectTypeOf<PayloadHasKey<'duplicateClip', 'targetClipId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'addAutomationLane', 'laneId'>>().toEqualTypeOf<false>();
        expectTypeOf<PayloadHasKey<'createVcaGroup', 'vcaGroupId'>>().toEqualTypeOf<false>();
        expectTypeOf<EmptyCollabSessionPayloadAllowed>().toEqualTypeOf<false>();
    });
});
