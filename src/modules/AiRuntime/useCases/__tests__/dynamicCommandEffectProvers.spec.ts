import { describe, expect, it } from 'vitest';

import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { dynamicEffectProofKindByActionType } from '../../models/DynamicEffectProofKindByActionType';
import { proveDynamicCommandEffects } from '../dynamicCommandEffectProvers';

function isAppActionType(value: string): value is AppActionType {
    return Object.hasOwn(dynamicEffectProofKindByActionType, value);
}

describe('dynamic command effect provers', () => {
    it('names exactly the action types whose effects depend on project state', () => {
        const actionTypes = Object.keys(dynamicEffectProofKindByActionType).filter(isAppActionType);
        const proven = actionTypes.filter((type) => dynamicEffectProofKindByActionType[type] !== 'none').sort();

        expect(proven).toEqual([
            'clearSolos',
            'duplicateClip',
            'duplicateClipToNextBar',
            'duplicateTrack',
            'invertAutomation',
            'quantizeAutomation',
            'removeClip',
            'removeTrack',
            'reverseAutomation',
            'scaleAutomation',
            'stretchAutomation',
            'thinAutomation',
        ]);
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
