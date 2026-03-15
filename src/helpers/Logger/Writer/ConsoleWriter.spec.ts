/* (c) Copyright Frontify Ltd., all rights reserved. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsoleWriter } from './ConsoleWriter';

describe('ConsoleWriter', () => {
    let writer: ConsoleWriter;

    beforeEach(() => {
        writer = new ConsoleWriter();
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('debug', () => {
        it('should call `console.debug` with correct prefix', () => {
            writer.debug('test message');
            expect(console.debug).toHaveBeenCalledWith('[DEV][DEBUG]', 'test message');
        });

        it('should handle multiple arguments', () => {
            writer.debug('test', 123, { key: 'value' });
            expect(console.debug).toHaveBeenCalledWith('[DEV][DEBUG]', 'test', 123, { key: 'value' });
        });
    });

    describe('info', () => {
        it('should call `console.info` with correct prefix', () => {
            writer.info('test message');
            expect(console.info).toHaveBeenCalledWith('[DEV][INFO]', 'test message');
        });

        it('should handle multiple arguments', () => {
            writer.info('test', 123, { key: 'value' });
            expect(console.info).toHaveBeenCalledWith('[DEV][INFO]', 'test', 123, { key: 'value' });
        });
    });

    describe('warn', () => {
        it('should call `console.warn` with correct prefix', () => {
            writer.warn('test message');
            expect(console.warn).toHaveBeenCalledWith('[DEV][WARN]', 'test message');
        });

        it('should handle multiple arguments', () => {
            writer.warn('test', 123, { key: 'value' });
            expect(console.warn).toHaveBeenCalledWith('[DEV][WARN]', 'test', 123, { key: 'value' });
        });
    });

    describe('error', () => {
        it('should call `console.error` with correct prefix', () => {
            const error = new Error('test message');
            writer.error(error);
            expect(console.error).toHaveBeenCalledWith('[DEV][ERROR]', error);
        });
    });
});
