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

    it('should call console.debug with prefix', () => {
        const writer = createConsoleWriter();
        writer.debug('test message');
        expect(console.debug).toHaveBeenCalledWith('[DEV][DEBUG]', 'test message');
    });

    it('should call console.info with prefix', () => {
        const writer = createConsoleWriter();
        writer.info('test message');
        expect(console.info).toHaveBeenCalledWith('[DEV][INFO]', 'test message');
    });

    it('should call console.warn with prefix', () => {
        const writer = createConsoleWriter();
        writer.warn('test message');
        expect(console.warn).toHaveBeenCalledWith('[DEV][WARN]', 'test message');
    });

    it('should call console.error with prefix', () => {
        const writer = createConsoleWriter();
        const error = new Error('test');
        writer.error(error);
        expect(console.error).toHaveBeenCalledWith('[DEV][ERROR]', error);
    });

    it('should handle multiple arguments', () => {
        const writer = createConsoleWriter();
        writer.info('test', 123, { key: 'value' });
        expect(console.info).toHaveBeenCalledWith('[DEV][INFO]', 'test', 123, { key: 'value' });
    });
});
