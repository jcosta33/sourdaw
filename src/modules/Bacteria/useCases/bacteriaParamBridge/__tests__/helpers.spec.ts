import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export createFlushParam', () => {
        expect(subject.createFlushParam).toBeDefined();
        const t = typeof subject.createFlushParam;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export encodePatchValue', () => {
        expect(subject.encodePatchValue).toBeDefined();
        const t = typeof subject.encodePatchValue;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});

describe('encodePatchValue', () => {
    let warnSpy: MockInstance<typeof logger.warn>;

    beforeEach(() => {
        warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('encodes numbers and booleans without warning', () => {
        expect(subject.encodePatchValue('drive', 42)).toBe(42);
        expect(subject.encodePatchValue('bypass', true)).toBe(1);
        expect(subject.encodePatchValue('bypass', false)).toBe(0);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('encodes known enum-string keys without warning', () => {
        expect(subject.encodePatchValue('distortionMode', 'foldback')).toBe(2);
        expect(subject.encodePatchValue('filterMode', 'bandpass')).toBe(2);
        expect(subject.encodePatchValue('grainWindow', 'gaussian')).toBe(1);
        expect(subject.encodePatchValue('crossoverMode', 'linear-phase')).toBe(1);
        expect(subject.encodePatchValue('globalRouting', 'parallel')).toBe(1);
        expect(subject.encodePatchValue('routingMode', 'mid-side')).toBe(2);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns null without warning for known non-audio string keys', () => {
        expect(subject.encodePatchValue('name', 'My Patch')).toBeNull();
        expect(subject.encodePatchValue('convolutionIr', 'cathedral')).toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns when an unrecognized string-valued key is dropped', () => {
        // Regression: a newly added string field that is not registered as a
        // mode-index map nor as a known non-audio key would silently never
        // reach the engine. The bridge must surface it in dev instead.
        expect(subject.encodePatchValue('newStringField', 'someValue')).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0]?.[0])).toContain('newStringField');
    });
});
