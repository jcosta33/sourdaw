import { describe, expect, it } from 'vitest';

import { createLlmActionStrategyRegistry } from '../createLlmActionStrategyRegistry';

describe('createLlmActionStrategyRegistry', () => {
    it('rejects duplicate definitions', () => {
        expect(() =>
            createLlmActionStrategyRegistry(
                [
                    { name: 'setTempo', transform: () => null },
                    { name: 'setTempo', transform: () => null },
                ],
                ['setTempo']
            )
        ).toThrow('Duplicate LLM action strategy: setTempo');
    });

    it('rejects definitions outside the canonical executable action catalogue', () => {
        expect(() =>
            createLlmActionStrategyRegistry([{ name: 'notCanonical', transform: () => null }], ['notCanonical'])
        ).toThrow('LLM action strategy is not a canonical executable action: notCanonical');
    });

    it('rejects an expected action name without a definition', () => {
        expect(() =>
            createLlmActionStrategyRegistry<'setTempo' | 'setPlayback', unknown, null>(
                [{ name: 'setTempo', transform: () => null }],
                ['setTempo', 'setPlayback']
            )
        ).toThrow('Missing LLM action strategy: setPlayback');
    });
});
