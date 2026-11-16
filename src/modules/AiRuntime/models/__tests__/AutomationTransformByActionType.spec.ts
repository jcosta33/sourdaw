import { describe, expect, it } from 'vitest';

import { automationTransformByActionType } from '../AutomationTransformByActionType';

describe('automationTransformByActionType', () => {
    it('marks exactly the six lane point rewrites as automation transforms', () => {
        const transforms = Object.entries(automationTransformByActionType)
            .filter(([, isTransform]) => isTransform)
            .map(([type]) => type);

        expect(transforms.toSorted()).toEqual([
            'invertAutomation',
            'quantizeAutomation',
            'reverseAutomation',
            'scaleAutomation',
            'stretchAutomation',
            'thinAutomation',
        ]);
    });

    it('leaves an action type the list does not name as no transform', () => {
        expect(automationTransformByActionType.addAutomationPoint).toBe(false);
    });
});
