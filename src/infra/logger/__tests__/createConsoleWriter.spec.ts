import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createConsoleWriter } from '../createConsoleWriter';

describe('createConsoleWriter', () => {
    beforeEach(() => {
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('development mode', () => {
        it('should call console.debug with prefix', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            writer.debug('test message');
            expect(console.debug).toHaveBeenCalledWith('[DEV][DEBUG]', 'test message');
        });

        it('should call console.info with prefix', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            writer.info('test message');
            expect(console.info).toHaveBeenCalledWith('[DEV][INFO]', 'test message');
        });

        it('should call console.warn with prefix', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            writer.warn('test message');
            expect(console.warn).toHaveBeenCalledWith('[DEV][WARN]', 'test message');
        });

        it('should call console.error with prefix', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const error = new Error('test');
            writer.error(error);
            expect(console.error).toHaveBeenCalledWith('[DEV][ERROR]', error);
        });

        it('should handle multiple arguments', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            writer.info('test', 123, { key: 'value' });
            expect(console.info).toHaveBeenCalledWith('[DEV][INFO]', 'test', 123, { key: 'value' });
        });
    });

    describe('production mode', () => {
        it('should not call console.debug', () => {
            const writer = createConsoleWriter({ mode: 'production' });
            writer.debug('test message');
            expect(console.debug).not.toHaveBeenCalled();
        });

        it('should not call console.info', () => {
            const writer = createConsoleWriter({ mode: 'production' });
            writer.info('test message');
            expect(console.info).not.toHaveBeenCalled();
        });

        it('should call console.warn with prefix', () => {
            const writer = createConsoleWriter({ mode: 'production' });
            writer.warn('test message');
            expect(console.warn).toHaveBeenCalledWith('[Sourdaw][WARN]', 'test message');
        });

        it('should call console.error with prefix', () => {
            const writer = createConsoleWriter({ mode: 'production' });
            const error = new Error('test');
            writer.error(error);
            expect(console.error).toHaveBeenCalledWith('[Sourdaw][ERROR]', error);
        });
    });
});
