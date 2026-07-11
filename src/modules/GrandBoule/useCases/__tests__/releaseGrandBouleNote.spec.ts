import { describe, it, expect } from 'vitest';
import { releaseGrandBouleNote } from '../releaseGrandBouleNote';
const mock_engine = new Proxy({}, { get: () => () => {} }) as never;
describe('releaseGrandBouleNote', () => {
    it('runs without crash', () => {
        expect(() => releaseGrandBouleNote({ engine: mock_engine, note: 60, channel: 0 } as never)).not.toThrow();
    });
});
