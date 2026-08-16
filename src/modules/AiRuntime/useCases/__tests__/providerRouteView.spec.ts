import { describe, expect, it } from 'vitest';

import { buildProviderRouteView } from '../providerRouteView';

describe('provider route view', () => {
    it('discloses requested and actual routes, fallback, capability, policy, and usage provenance', () => {
        expect(
            buildProviderRouteView({
                requestedRoute: 'remote',
                actualRoute: 'native-local',
                availability: { status: 'available', reason: null },
                capability: { role: 'tool-planning', fidelity: 'schema-constrained' },
                fallback: { attempted: true, reason: 'remote-unavailable' },
                dataPolicy: {
                    categories: ['prompt-text'],
                    retention: {
                        applicationState: 'unknown',
                        abuseMonitoring: 'unknown',
                        promptCache: 'unknown',
                        safetyLegalException: 'unknown',
                        unknown: 'unknown',
                    },
                },
                usage: { provenance: 'provider-reported', priceProvenance: 'unavailable' },
            })
        ).toEqual({
            requestedRoute: 'remote',
            actualRoute: 'native-local',
            availability: { status: 'available', reason: null },
            capability: { role: 'tool-planning', fidelity: 'schema-constrained' },
            fallback: { attempted: true, reason: 'remote-unavailable' },
            dataPolicy: {
                categories: ['prompt-text'],
                retention: {
                    applicationState: 'unknown',
                    abuseMonitoring: 'unknown',
                    promptCache: 'unknown',
                    safetyLegalException: 'unknown',
                    unknown: 'unknown',
                },
            },
            usage: { provenance: 'provider-reported', priceProvenance: 'unavailable' },
        });
    });
});
