import { describe, expect, it } from 'vitest';

import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { automationTransformByActionType } from '../../models/AutomationTransformByActionType';
import { dynamicEffectProofKindByActionType } from '../../models/DynamicEffectProofKindByActionType';
import { proveDynamicCommandEffects } from '../dynamicCommandEffectProvers';

function isAppActionType(value: string): value is AppActionType {
    return Object.hasOwn(dynamicEffectProofKindByActionType, value);
}

describe('dynamic command effect provers', () => {
    it('maps exactly these action types to their proof kind', () => {
        const actionTypes = Object.keys(dynamicEffectProofKindByActionType).filter(isAppActionType);
        const provenTypes = actionTypes.filter((type) => dynamicEffectProofKindByActionType[type] !== 'none');
        const pairs = provenTypes.map((type) => [type, dynamicEffectProofKindByActionType[type]]);
        const proven = pairs.sort();

        expect(proven).toEqual([
            ['clearSolos', 'clearSolos'],
            ['duplicateClip', 'duplicateClip'],
            ['duplicateClipToNextBar', 'duplicateClip'],
            ['duplicateTrack', 'duplicateTrack'],
            ['invertAutomation', 'automationLaneRewrite'],
            ['quantizeAutomation', 'automationLaneRewrite'],
            ['removeClip', 'removeClip'],
            ['removeTrack', 'removeTrack'],
            ['reverseAutomation', 'automationLaneRewrite'],
            ['scaleAutomation', 'automationLaneRewrite'],
            ['stretchAutomation', 'automationLaneRewrite'],
            ['thinAutomation', 'automationLaneRewrite'],
        ]);
    });

    it('proves automation lane rewrites for exactly the types the transform record marks', () => {
        const actionTypes = Object.keys(dynamicEffectProofKindByActionType).filter(isAppActionType);
        const proven = actionTypes
            .filter((type) => dynamicEffectProofKindByActionType[type] === 'automationLaneRewrite')
            .sort();
        const transforms = actionTypes.filter((type) => automationTransformByActionType[type]).sort();

        expect(proven).toEqual(transforms);
    });

    it('proves nothing for an untrusted inherited action type', () => {
        const action: AppAction = JSON.parse('{"type":"constructor","payload":{}}');
        const effects = {
            affectedTrackIds: new Set<string>(),
            affectedClipIds: new Set<string>(),
            affectedTargetIds: new Set<string>(),
            automationPoints: 0,
            deletedObjects: 0,
        };

        expect(Object.hasOwn(dynamicEffectProofKindByActionType, action.type)).toBe(false);
        expect(() =>
            proveDynamicCommandEffects({
                actionType: action.type,
                context: { tracks: [] },
                payload: {},
                protectedTargetIds: undefined,
                effects,
            })
        ).not.toThrow();
        expect(effects.affectedTrackIds.size).toBe(0);
    });
});
