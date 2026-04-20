import { describe, it, expect, vi } from 'vitest';

import { createLogger } from '../createLogger';
import { type LogWriter } from '../types';

const createDummyWriter = (): LogWriter => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
});

describe('createLogger', () => {
    it('should create a logger without writers', () => {
        const logger = createLogger();
        // Should not throw when no writers are attached
        logger.debug('test');
        logger.info('test');
        logger.warn('test');
        logger.error(new Error('test'));
    });

    it('should forward debug calls to all writers', () => {
        const writer = createDummyWriter();
        const logger = createLogger([writer]);

        logger.debug('hello', 42);

        expect(writer.debug).toHaveBeenCalledWith('hello', 42);
    });

    it('should forward info calls to all writers', () => {
        const writer = createDummyWriter();
        const logger = createLogger([writer]);

        logger.info('hello');

        expect(writer.info).toHaveBeenCalledWith('hello');
    });

    it('should forward warn calls to all writers', () => {
        const writer = createDummyWriter();
        const logger = createLogger([writer]);

        logger.warn('caution');

        expect(writer.warn).toHaveBeenCalledWith('caution');
    });

    it('should forward error calls to all writers', () => {
        const writer = createDummyWriter();
        const logger = createLogger([writer]);
        const err = new Error('boom');

        logger.error(err);

        expect(writer.error).toHaveBeenCalledWith(err);
    });

    it('should forward to multiple writers', () => {
        const writer1 = createDummyWriter();
        const writer2 = createDummyWriter();
        const logger = createLogger([writer1, writer2]);

        logger.info('broadcast');

        expect(writer1.info).toHaveBeenCalledWith('broadcast');
        expect(writer2.info).toHaveBeenCalledWith('broadcast');
    });

    it('should replace writers with setWriters', () => {
        const old = createDummyWriter();
        const replacement = createDummyWriter();
        const logger = createLogger([old]);

        logger.setWriters(replacement);
        logger.info('after swap');

        expect(old.info).not.toHaveBeenCalled();
        expect(replacement.info).toHaveBeenCalledWith('after swap');
    });
});
