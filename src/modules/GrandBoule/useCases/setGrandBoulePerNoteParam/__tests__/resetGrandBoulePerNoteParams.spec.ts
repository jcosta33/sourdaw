import { describe, it, expect } from 'vitest';
import { resetGrandBoulePerNoteParams } from '../resetGrandBoulePerNoteParams';
const mock_engine = new Proxy({}, { get: () => () => {} }) as never;
describe('resetGrandBoulePerNoteParams', () => {
    it('runs without crash', () => {
        const setPerNoteMap = () => {};
        const perNoteMap = new Map();
        expect(() => resetGrandBoulePerNoteParams({
            store: { value: {}, set: () => {} }, engine: mock_engine, key: 40, perNoteMap, setPerNoteMap,
        } as never)).not.toThrow();
    });
});
