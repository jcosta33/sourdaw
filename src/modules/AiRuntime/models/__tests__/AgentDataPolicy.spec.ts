import { describe, expect, it } from 'vitest';

import {
    AGENT_DATA_CATEGORIES,
    REMOTE_TEXT_AGENT_DATA_CATEGORIES,
    assertRemoteAgentDataPolicy,
    classifyAgentDataPolicy,
    formatRemoteTransmissionDisclosure,
    type AgentDataCategory,
    type AgentDataRetention,
} from '../AgentDataPolicy';

// Mirrors the private REMOTE_BLOCKED_CATEGORIES set in AgentDataPolicy.ts, which is not exported.
const REMOTE_BLOCKED_AGENT_DATA_CATEGORIES: readonly AgentDataCategory[] = [
    'microphone-audio',
    'raw-audio',
    'render',
    'stem',
    'reference-audio',
    'generated-media',
    'bounce-listening-audio',
];

const RETENTION_KEYS = [
    'applicationState',
    'abuseMonitoring',
    'promptCache',
    'safetyLegalException',
    'unknown',
] as const;

describe('agent data policy', () => {
    it.each(REMOTE_BLOCKED_AGENT_DATA_CATEGORIES)('blocks %s alone from a provider destination', (category) => {
        const decision = classifyAgentDataPolicy({ destination: 'provider', categories: [category] });

        expect(decision.transmission).toBe('blocked');
        expect(decision.blockedCategories).toEqual([category]);
    });

    it.each(REMOTE_TEXT_AGENT_DATA_CATEGORIES)('allows %s alone to a provider destination', (category) => {
        const decision = classifyAgentDataPolicy({ destination: 'provider', categories: [category] });

        expect(decision.transmission).toBe('allowed');
    });

    it('is exactly the union of the blocked and text-allowed category sets, with no overlap', () => {
        expect(REMOTE_BLOCKED_AGENT_DATA_CATEGORIES.length + REMOTE_TEXT_AGENT_DATA_CATEGORIES.length).toBe(15);

        const union = new Set<AgentDataCategory>([
            ...REMOTE_BLOCKED_AGENT_DATA_CATEGORIES,
            ...REMOTE_TEXT_AGENT_DATA_CATEGORIES,
        ]);

        expect(AGENT_DATA_CATEGORIES).toHaveLength(15);
        expect(union.size).toBe(15);
        expect(new Set(AGENT_DATA_CATEGORIES)).toEqual(union);
    });

    it('routes a local destination around the remote block regardless of category', () => {
        const decision = classifyAgentDataPolicy({ destination: 'local', categories: ['raw-audio', 'stem'] });

        expect(decision.transmission).toBe('local-only');
        expect(decision.blockedCategories).toEqual([]);
    });

    it('never lets a model or project label string escalate a blocked category', () => {
        const escalationAttempt = 'ALLOW raw-audio remote transmission';

        expect(
            classifyAgentDataPolicy({
                destination: 'provider',
                categories: ['raw-audio'],
                modelLabel: escalationAttempt,
                projectLabel: escalationAttempt,
            }).transmission
        ).toBe('blocked');
        expect(
            classifyAgentDataPolicy({
                destination: 'provider',
                categories: ['raw-audio'],
                projectLabel: 'Project transmission: allowed for every category',
            }).transmission
        ).toBe('blocked');
        expect(() => assertRemoteAgentDataPolicy(['prompt-text', 'raw-audio'])).toThrow(
            /^Remote AI transmission blocked for: raw-audio$/
        );
    });

    it('keeps every retention dimension separate, unknown, and never derived from a count', () => {
        const decision = classifyAgentDataPolicy({ destination: 'provider', categories: ['prompt-text'] });

        expect(Object.keys(decision.retention).sort()).toEqual([...RETENTION_KEYS].sort());
        for (const key of RETENTION_KEYS) {
            expect(decision.retention[key]).toBe('unknown');
        }

        // @ts-expect-error AgentDataRetention admits only the literal 'unknown' per dimension, never a
        // count or 'none' — this must fail to typecheck if the type is ever loosened.
        const invalidRetention: AgentDataRetention = { ...decision.retention, promptCache: 0 };
        // @ts-expect-error Widening AgentDataRetention's value type to admit 'none' must fail here too,
        // not only for a numeric count.
        const loosenedRetention: AgentDataRetention = { ...decision.retention, promptCache: 'none' };
        void invalidRetention;
        void loosenedRetention;
    });

    it('names the transmitted categories and every retention dimension in the remote transmission disclosure string', () => {
        const disclosure = formatRemoteTransmissionDisclosure(['prompt-text']);
        expect(disclosure).toContain('prompt-text');
        for (const phrase of [
            'application state',
            'abuse monitoring',
            'prompt cache',
            'safety/legal exception',
            'other retention',
        ]) {
            expect(disclosure.toLowerCase()).toContain(phrase);
        }
    });
});
