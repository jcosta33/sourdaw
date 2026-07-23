import { describe, it, expect } from 'vitest';

import { DEFAULT_CRDT_ROOT_LINEAGE, MAX_CRDT_ROOT_LINEAGE_LENGTH, parseCrdtRootLineage } from '../CrdtRootLineage';

describe('parseCrdtRootLineage', () => {
    it('accepts a simple alphanumeric branch name', () => {
        expect(parseCrdtRootLineage('main')).toBe('main');
    });

    it('accepts names with dots, dashes, and underscores after the first char', () => {
        expect(parseCrdtRootLineage('feature.branch-v2_c')).toBe('feature.branch-v2_c');
    });

    it('accepts the default root lineage constant', () => {
        expect(parseCrdtRootLineage(DEFAULT_CRDT_ROOT_LINEAGE)).toBe(DEFAULT_CRDT_ROOT_LINEAGE);
    });

    it('rejects a name starting with a non-alphanumeric character', () => {
        expect(parseCrdtRootLineage('-branch')).toBeNull();
        expect(parseCrdtRootLineage('.hidden')).toBeNull();
        expect(parseCrdtRootLineage('_internal')).toBeNull();
    });

    it('rejects an empty string', () => {
        expect(parseCrdtRootLineage('')).toBeNull();
    });

    it('rejects a name exceeding the max length', () => {
        const tooLong = 'a'.repeat(MAX_CRDT_ROOT_LINEAGE_LENGTH + 1);
        expect(parseCrdtRootLineage(tooLong)).toBeNull();
    });

    it('accepts a name exactly at the max length boundary', () => {
        const atLimit = 'a'.repeat(MAX_CRDT_ROOT_LINEAGE_LENGTH);
        expect(parseCrdtRootLineage(atLimit)).toBe(atLimit);
    });

    it('rejects names with slashes (not in the allowed charset)', () => {
        expect(parseCrdtRootLineage('feature/branch')).toBeNull();
    });

    it('rejects names with spaces', () => {
        expect(parseCrdtRootLineage('my branch')).toBeNull();
    });

    it('rejects non-string values', () => {
        expect(parseCrdtRootLineage(null)).toBeNull();
        expect(parseCrdtRootLineage(42)).toBeNull();
        expect(parseCrdtRootLineage(undefined)).toBeNull();
        expect(parseCrdtRootLineage({ branch: 'main' })).toBeNull();
    });

    it('returns the value unchanged (no normalization)', () => {
        // Distinct tokens are not normalized together — 'MAIN' ≠ 'main'.
        expect(parseCrdtRootLineage('MAIN')).toBe('MAIN');
        expect(parseCrdtRootLineage('Main')).toBe('Main');
    });
});
