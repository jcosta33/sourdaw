import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('writeNamedProjectJsonByKey', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.resetModules();
    });

    it('writes the named project under the caller-owned stable key', async () => {
        const { writeNamedProjectJsonByKey } = await import('../writeNamedProjectJsonByKey');
        const key = 'sourdaw:project:1700000000000';
        const json = JSON.stringify({ version: 1, name: 'Small' });

        writeNamedProjectJsonByKey(key, json);

        expect(localStorage.getItem(key)).toBe(json);
    });
});
