/* (c) Copyright Frontify Ltd., all rights reserved. */

import { describe, it, expect } from 'vitest';

import { Configuration } from './Configuration';

describe('Configuration', () => {
    const getAllConfigurationGetters = (): string[] => {
        return Object.entries(Object.getOwnPropertyDescriptors(Configuration.prototype))
            .filter(([_, descriptor]) => typeof descriptor.get === 'function')
            .map(([key]) => key);
    };

    describe('source merging', () => {
        it('should merge multiple sources', () => {
            const source1 = { amplitudeApiKey: 'key1' };
            const source2 = { pusherKey: 'key2' };

            const config = new Configuration(source1, source2);

            expect(config.amplitudeApiKey).toBe('key1');
            expect(config.pusherKey).toBe('key2');
        });

        it('should prioritize later sources', () => {
            const source1 = { amplitudeApiKey: 'key1' };
            const source2 = { amplitudeApiKey: 'key2' };

            const config = new Configuration(source1, source2);

            expect(config.amplitudeApiKey).toBe('key2');
        });
    });

    describe('individual getters', () => {
        const validConfig = {
            amplitudeApiKey: 'test-api-key',
            amplitudeEnabled: true,
            environment: 'testing',
            intercomEnabled: true,
            intercomSettings: { setting: 'value' },
            locales: { 'en.json': '/locales/en.json', 'de.json': '/locales/de.json' },
            pusherCluster: 'test-cluster',
            pusherEnabled: true,
            pusherKey: 'test-pusher-key',
            segmentEnabled: true,
            segmentKey: 'test-segment-key',
            sentryDsn: 'test-sentry-dsn',
            sentryEnabled: false,
        };
        const getters = getAllConfigurationGetters();

        const config = new Configuration(validConfig);

        it('should have a test for each configuration entry', () => {
            expect(getters).toEqual(Object.keys(validConfig));
        });

        it('should handle all string values', () => {
            expect(config.amplitudeApiKey).toBe('test-api-key');
            expect(config.environment).toBe('testing');
            expect(config.pusherKey).toBe('test-pusher-key');
            expect(config.pusherCluster).toBe('test-cluster');
            expect(config.segmentKey).toBe('test-segment-key');
            expect(config.sentryDsn).toBe('test-sentry-dsn');
        });

        it('should handle all boolean values', () => {
            expect(config.amplitudeEnabled).toBe(true);
            expect(config.intercomEnabled).toBe(true);
            expect(config.pusherEnabled).toBe(true);
            expect(config.segmentEnabled).toBe(true);
            expect(config.sentryEnabled).toBe(false);
        });

        it('should handle object values', () => {
            expect(config.intercomSettings).toEqual({ setting: 'value' });
            expect(config.locales).toEqual({ 'en.json': '/locales/en.json', 'de.json': '/locales/de.json' });
        });
    });

    describe('also valid scenario', () => {
        it('should parse the stringified boolean values', () => {
            const config = new Configuration({ amplitudeEnabled: 'true', segmentEnabled: 'false' });
            expect(config.amplitudeEnabled).toBe(true);
            expect(config.segmentEnabled).toBe(false);
        });

        it('should parse the uppercase stringified boolean values', () => {
            const config = new Configuration({ amplitudeEnabled: 'TRUE', segmentEnabled: 'FALSE' });
            expect(config.amplitudeEnabled).toBe(true);
            expect(config.segmentEnabled).toBe(false);
        });
    });

    describe('invalid configuration', () => {
        it('should throw for non-string', () => {
            const config = new Configuration({ amplitudeApiKey: 42 });
            expect(() => config.amplitudeApiKey).toThrow(TypeError);
        });

        it('should throw for non-boolean', () => {
            const config = new Configuration({ amplitudeEnabled: 'not-a-boolean' });
            expect(() => config.amplitudeEnabled).toThrow(TypeError);
        });

        it('should throw for non-object', () => {
            const config = new Configuration({ intercomSettings: 'not-an-object' });
            expect(() => config.intercomSettings).toThrow(TypeError);
        });

        it('should handle null values', () => {
            const config = new Configuration({ environment: null });
            expect(() => config.environment).toThrow(TypeError);
        });

        it('should handle undefined values', () => {
            const config = new Configuration({ environment: undefined });
            expect(() => config.environment).toThrow(TypeError);
        });
    });
});
