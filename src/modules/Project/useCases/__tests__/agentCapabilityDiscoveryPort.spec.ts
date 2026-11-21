import { describe, expect, it } from 'vitest';

import { agentCapabilityDiscoveryPort } from '../agentCapabilityDiscoveryPort';

const first = { version: 'port-spec-v1', entries: [] };
const second = { version: 'port-spec-v2', entries: [] };

describe('agentCapabilityDiscoveryPort', () => {
    it('refuses to read before a provider is registered, naming the registrar', () => {
        expect(() => agentCapabilityDiscoveryPort.read()).toThrow(/setProvider\(\) from #\/app\/bootstrap/);
    });

    it('reads through the registered provider', () => {
        agentCapabilityDiscoveryPort.setProvider(() => first);

        expect(agentCapabilityDiscoveryPort.read()).toBe(first);
    });

    it('replaces the registered provider on a second fill', () => {
        agentCapabilityDiscoveryPort.setProvider(() => second);

        expect(agentCapabilityDiscoveryPort.read()).toBe(second);
    });
});
