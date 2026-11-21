import { describe, expect, it } from 'vitest';

import {
    automationParameterRangePort,
    setAutomationParameterRangeResolver,
} from '../automationParameterRangeDependencies';

const input = { trackId: 'track-1', parameterTargetId: 'device-1:cutoff' };

function resolver(): { minValue: number; maxValue: number } {
    return { minValue: 20, maxValue: 20000 };
}

function otherResolver(): null {
    return null;
}

describe('automationParameterRangeDependencies', () => {
    it('throws naming the registrar when read before registration', () => {
        expect(() => automationParameterRangePort.read()).toThrow(
            'automationParameterRangePort.read: the automation parameter range resolver is not registered; call setAutomationParameterRangeResolver() from #/app/bootstrap'
        );
    });

    it('returns what was filled', () => {
        setAutomationParameterRangeResolver(resolver);

        expect(automationParameterRangePort.read()(input)).toEqual({ minValue: 20, maxValue: 20000 });
    });

    it('replaces the first fill with a second whose null answer means no declared range', () => {
        setAutomationParameterRangeResolver(resolver);
        setAutomationParameterRangeResolver(otherResolver);

        expect(automationParameterRangePort.read()(input)).toBeNull();
    });
});
