import { describe, it, expect } from 'vitest';

import { compareProjectSnapshots } from '../compareProjectSnapshots';

function projectJson(updatedAt: number): string {
    return JSON.stringify({ meta: { updatedAt } });
}

describe('compareProjectSnapshots — verdict logic', () => {
    it('returns primary-newer-or-equal when primary timestamp >= mirror', () => {
        const result = compareProjectSnapshots({ primary: projectJson(200), mirror: projectJson(100) });
        expect(result.verdict).toBe('primary-newer-or-equal');
        expect(result.primaryReadable).toBe(true);
        expect(result.mirrorReadable).toBe(true);
    });

    it('returns primary-newer-or-equal on a tie (primary wins)', () => {
        const result = compareProjectSnapshots({ primary: projectJson(200), mirror: projectJson(200) });
        expect(result.verdict).toBe('primary-newer-or-equal');
    });

    it('returns mirror-newer when mirror timestamp > primary', () => {
        const result = compareProjectSnapshots({ primary: projectJson(100), mirror: projectJson(200) });
        expect(result.verdict).toBe('mirror-newer');
    });
});

describe('compareProjectSnapshots — indeterminate (unreadable)', () => {
    it('returns indeterminate when primary is corrupt JSON', () => {
        const result = compareProjectSnapshots({ primary: 'corrupt', mirror: projectJson(200) });
        expect(result.verdict).toBe('indeterminate');
        expect(result.primaryReadable).toBe(false);
        expect(result.mirrorReadable).toBe(true);
    });

    it('returns indeterminate when mirror is corrupt JSON', () => {
        const result = compareProjectSnapshots({ primary: projectJson(200), mirror: 'corrupt' });
        expect(result.verdict).toBe('indeterminate');
        expect(result.primaryReadable).toBe(true);
        expect(result.mirrorReadable).toBe(false);
    });

    it('returns indeterminate when both are corrupt', () => {
        const result = compareProjectSnapshots({ primary: 'bad', mirror: 'also bad' });
        expect(result.verdict).toBe('indeterminate');
        expect(result.primaryReadable).toBe(false);
        expect(result.mirrorReadable).toBe(false);
    });

    it('returns indeterminate when primary is missing meta', () => {
        const result = compareProjectSnapshots({ primary: '{"foo":1}', mirror: projectJson(200) });
        expect(result.verdict).toBe('indeterminate');
        expect(result.primaryReadable).toBe(false);
    });

    it('returns indeterminate when meta has no updatedAt', () => {
        const result = compareProjectSnapshots({ primary: '{"meta":{}}', mirror: projectJson(200) });
        expect(result.verdict).toBe('indeterminate');
        expect(result.primaryReadable).toBe(false);
    });

    it('returns indeterminate when updatedAt is not a number', () => {
        const result = compareProjectSnapshots({
            primary: '{"meta":{"updatedAt":"yesterday"}}',
            mirror: projectJson(200),
        });
        expect(result.verdict).toBe('indeterminate');
        expect(result.primaryReadable).toBe(false);
    });

    it('returns indeterminate when updatedAt is Infinity', () => {
        const result = compareProjectSnapshots({
            primary: '{"meta":{"updatedAt":Infinity}}',
            mirror: projectJson(200),
        });
        expect(result.verdict).toBe('indeterminate');
        expect(result.primaryReadable).toBe(false);
    });

    it('returns indeterminate when parsed value is null', () => {
        const result = compareProjectSnapshots({ primary: 'null', mirror: projectJson(200) });
        expect(result.verdict).toBe('indeterminate');
        expect(result.primaryReadable).toBe(false);
    });

    it('returns indeterminate when parsed value is an array (not object)', () => {
        const result = compareProjectSnapshots({ primary: '[1,2,3]', mirror: projectJson(200) });
        expect(result.verdict).toBe('indeterminate');
        expect(result.primaryReadable).toBe(false);
    });
});
