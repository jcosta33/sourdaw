/* (c) Copyright Frontify Ltd., all rights reserved. */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Logger } from './Logger';
import { type Writer } from './Writer/Writer';

class DummyWriter implements Writer {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
}

describe('Logger', () => {
    let logger: Logger;
    let dummyWriter: DummyWriter;

    beforeEach(() => {
        dummyWriter = new DummyWriter();
        logger = new Logger([dummyWriter]);
    });

    describe('constructor', () => {
        it('should initialize without writers', () => {
            const emptyLogger = new Logger();
            expect(emptyLogger).toBeInstanceOf(Logger);
        });

        it('should initialize with writers', () => {
            expect(logger).toBeInstanceOf(Logger);
        });
    });

    describe('logging methods', () => {
        it('should call debug on all writers', () => {
            const args = ['test message', { detail: 'test' }];
            logger.debug(...args);
            expect(dummyWriter.debug).toHaveBeenCalledWith(...args);
        });

        it('should call info on all writers', () => {
            const args = ['test message', { detail: 'test' }];
            logger.info(...args);
            expect(dummyWriter.info).toHaveBeenCalledWith(...args);
        });

        it('should call warn on all writers', () => {
            const args = ['test message', { detail: 'test' }];
            logger.warn(...args);
            expect(dummyWriter.warn).toHaveBeenCalledWith(...args);
        });

        it('should call error on all writers', () => {
            const args = new Error('test message');
            logger.error(args);
            expect(dummyWriter.error).toHaveBeenCalledWith(args);
        });
    });

    describe('multiple writers', () => {
        it('should call all writers', () => {
            const secondWriter = new DummyWriter();
            logger.setWriters(dummyWriter, secondWriter);

            const args = ['test message'];
            logger.info(...args);

            expect(dummyWriter.info).toHaveBeenCalledWith(...args);
            expect(secondWriter.info).toHaveBeenCalledWith(...args);
        });
    });

    describe('setWriters', () => {
        it('should replace existing writers', () => {
            const newWriter = new DummyWriter();
            logger.setWriters(newWriter);

            const args = ['test message'];
            logger.info(...args);

            expect(dummyWriter.info).not.toHaveBeenCalled();
            expect(newWriter.info).toHaveBeenCalledWith(...args);
        });
    });
});
