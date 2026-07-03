import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { encodePatchValue } from '../helpers';

describe('encodePatchValue', () => {
    let warnSpy: MockInstance<typeof logger.warn>;

    beforeEach(() => {
        warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('should encode numbers and booleans without warning', () => {
        expect(encodePatchValue('drive', 42)).toBe(42);
        expect(encodePatchValue('bypass', true)).toBe(1);
        expect(encodePatchValue('bypass', false)).toBe(0);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should return null for non-string unknown values without warning', () => {
        expect(encodePatchValue('drive', null)).toBeNull();
        expect(encodePatchValue('drive', undefined)).toBeNull();
        expect(encodePatchValue('drive', { value: 1 })).toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should encode known enum-string keys without warning', () => {
        expect(encodePatchValue('distortionMode', 'foldback')).toBe(2);
        expect(encodePatchValue('filterMode', 'bandpass')).toBe(2);
        expect(encodePatchValue('grainWindow', 'gaussian')).toBe(1);
        expect(encodePatchValue('crossoverMode', 'linear-phase')).toBe(1);
        expect(encodePatchValue('globalRouting', 'parallel')).toBe(1);
        expect(encodePatchValue('routingMode', 'mid-side')).toBe(2);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should fall back to zero for unknown strings on known mode keys without warning', () => {
        expect(encodePatchValue('distortionMode', 'future-drive')).toBe(0);
        expect(encodePatchValue('filterMode', 'future-filter')).toBe(0);
        expect(encodePatchValue('grainWindow', 'future-window')).toBe(0);
        expect(encodePatchValue('crossoverMode', 'future-crossover')).toBe(0);
        expect(encodePatchValue('globalRouting', 'future-global-route')).toBe(0);
        expect(encodePatchValue('routingMode', 'future-route')).toBe(0);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should return null without warning for known non-audio string keys', () => {
        expect(encodePatchValue('name', 'My Patch')).toBeNull();
        expect(encodePatchValue('convolutionIr', 'cathedral')).toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should warn when an unrecognized string-valued key is dropped', () => {
        // Regression: a newly added string field that is not registered as a
        // mode-index map nor as a known non-audio key would silently never
        // reach the engine. The bridge must surface it in dev instead.
        expect(encodePatchValue('newStringField', 'someValue')).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0]?.[0])).toContain('newStringField');
    });
});
