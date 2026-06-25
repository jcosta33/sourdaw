import { describe, it, expect } from 'vitest';

import { CURRENT_PROJECT_VERSION, MIN_SUPPORTED_PROJECT_VERSION, isSupportedProjectVersion } from '../ProjectData';

describe('project version constants', () => {
    it('keeps the supported floor at or below the current version', () => {
        expect(MIN_SUPPORTED_PROJECT_VERSION).toBeLessThanOrEqual(CURRENT_PROJECT_VERSION);
    });
});

describe('isSupportedProjectVersion', () => {
    it('accepts the current version', () => {
        expect(isSupportedProjectVersion(CURRENT_PROJECT_VERSION)).toBe(true);
    });

    it('accepts the minimum supported version', () => {
        expect(isSupportedProjectVersion(MIN_SUPPORTED_PROJECT_VERSION)).toBe(true);
    });

    it('rejects a version below the supported floor', () => {
        expect(isSupportedProjectVersion(MIN_SUPPORTED_PROJECT_VERSION - 1)).toBe(false);
    });

    it('rejects a version above the current version', () => {
        expect(isSupportedProjectVersion(CURRENT_PROJECT_VERSION + 1)).toBe(false);
    });

    it('rejects non-integer and non-number versions', () => {
        expect(isSupportedProjectVersion(1.5)).toBe(false);
        expect(isSupportedProjectVersion('1')).toBe(false);
        expect(isSupportedProjectVersion(undefined)).toBe(false);
        expect(isSupportedProjectVersion(null)).toBe(false);
        expect(isSupportedProjectVersion(NaN)).toBe(false);
    });
});
