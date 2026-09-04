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

    it('rejects an expected action name without a definition', () => {
        expect(() =>
            createLlmActionStrategyRegistry<'setTempo' | 'setPlayback', unknown, null>(
                [{ name: 'setTempo', transform: () => null }],
                ['setTempo', 'setPlayback']
            )
        ).toThrow('Missing LLM action strategy: setPlayback');
    });
});
