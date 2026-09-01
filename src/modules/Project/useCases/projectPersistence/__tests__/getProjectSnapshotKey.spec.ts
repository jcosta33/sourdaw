import { describe, expect, it } from 'vitest';

import { getProjectSnapshotKey } from '../getProjectSnapshotKey';

describe('getProjectSnapshotKey', () => {
    it('keeps the named-project authority stable across canonical identity migration', () => {
        expect(getProjectSnapshotKey(1700000000000)).toBe('sourdaw:project:1700000000000');
    });
});
