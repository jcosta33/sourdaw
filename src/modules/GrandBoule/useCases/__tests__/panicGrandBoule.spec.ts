import { describe, it, expect } from 'vitest';
import { panicGrandBoule } from '../panicGrandBoule';
const mock_engine = new Proxy({}, { get: () => () => {} }) as never;
describe('panicGrandBoule', () => {
    it('runs without crash', () => {
        expect(() => panicGrandBoule({ engine: mock_engine } as never)).not.toThrow();
    });
});
