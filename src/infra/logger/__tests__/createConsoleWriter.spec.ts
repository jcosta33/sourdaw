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

        it('adds a plain diagnostic for nested committed-action failures while preserving the original Error', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const runtime = Object.assign(new Error('Device runtime delta rejected: compiled chain mismatch'), {
                privateContext: 'private-context-marker',
            });
            const reconciliation = new Error('Runtime reconciliation also failed');
            const aggregate = new AggregateError([runtime, reconciliation], 'Post-commit effects failed');
            const outer = new Error('Action committed but post-commit processing failed: addDevice', {
                cause: aggregate,
            });

            writer.error(outer);

            const call = vi.mocked(console.error).mock.calls[0];
            expect(call).toHaveLength(3);
            expect(call?.[0]).toBe('[DEV][ERROR]');
            expect(call?.[1]).toBe(outer);
            expect(typeof call?.[2]).toBe('string');
            expect(call?.[2]).toContain('AggregateError: Post-commit effects failed');
            expect(call?.[2]).toContain('Device runtime delta rejected: compiled chain mismatch');
            expect(call?.[2]).toContain('Runtime reconciliation also failed');
            expect(call?.[2]).not.toContain('private-context-marker');
        });

        it('keeps native errors and causes from another realm in the diagnostic', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const iframe = document.createElement('iframe');
            document.body.append(iframe);
            try {
                const foreignWindow = iframe.contentWindow;
                if (!foreignWindow) {
                    throw new Error('Missing iframe window');
                }
                const foreignErrorConstructor: unknown = Reflect.get(foreignWindow, 'Error');
                if (typeof foreignErrorConstructor !== 'function') {
                    throw new TypeError('Missing iframe Error constructor');
                }
                const foreignCause: Error = Reflect.construct(foreignErrorConstructor, ['foreign cause']);
                const foreignRoot: Error = Reflect.construct(foreignErrorConstructor, [
                    'foreign root',
                    { cause: foreignCause },
                ]);

                writer.error(foreignRoot);

                const call = vi.mocked(console.error).mock.calls[0];
                expect(call?.[1]).toBe(foreignRoot);
                expect(call?.[2]).toContain('foreign root');
                expect(call?.[2]).toContain('foreign cause');
            } finally {
                iframe.remove();
            }
        });

        it('keeps native aggregate errors and children from another realm in the diagnostic', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const iframe = document.createElement('iframe');
            document.body.append(iframe);
            try {
                const foreignWindow = iframe.contentWindow;
                if (!foreignWindow) {
                    throw new Error('Missing iframe window');
                }
                const foreignErrorConstructor: unknown = Reflect.get(foreignWindow, 'Error');
                if (typeof foreignErrorConstructor !== 'function') {
                    throw new TypeError('Missing iframe Error constructor');
                }
                const foreignAggregateErrorConstructor: unknown = Reflect.get(foreignWindow, 'AggregateError');
                if (typeof foreignAggregateErrorConstructor !== 'function') {
                    throw new TypeError('Missing iframe AggregateError constructor');
                }
                const foreignChild: Error = Reflect.construct(foreignErrorConstructor, ['foreign aggregate child']);
                const foreignAggregate: Error = Reflect.construct(foreignAggregateErrorConstructor, [
                    [foreignChild],
                    'foreign aggregate',
                ]);
                const root = new Error('local root', { cause: foreignAggregate });

                writer.error(root);

                const call = vi.mocked(console.error).mock.calls[0];
                expect(call?.[1]).toBe(root);
                expect(call?.[2]).toContain('foreign aggregate');
                expect(call?.[2]).toContain('foreign aggregate child');
            } finally {
                iframe.remove();
            }
        });

        it('keeps an empty aggregate error on the original one-argument development call', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const error = new AggregateError([], 'no failures');

            writer.error(error);

            expect(console.error).toHaveBeenCalledWith('[DEV][ERROR]', error);
            expect(vi.mocked(console.error).mock.calls[0]).toHaveLength(2);
        });

        it('does not treat Error-shaped objects or private fields as native errors', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const prototypeFake = Object.create(Error.prototype);
            Object.defineProperties(prototypeFake, {
                name: { value: 'FakeError' },
                message: { value: 'fake prototype detail' },
                [Symbol.toStringTag]: { value: 'Error' },
            });

            class PrivateFieldFake {
                readonly #privateContext = 'private-context-marker';

                get message(): string {
                    return this.#privateContext;
                }
            }

            Object.setPrototypeOf(PrivateFieldFake.prototype, Error.prototype);
            const privateFieldFake = new PrivateFieldFake();
            const root = new Error('root', {
                cause: new AggregateError([prototypeFake, privateFieldFake], 'fake children'),
            });

            writer.error(root);

            const diagnostic = vi.mocked(console.error).mock.calls[0]?.[2];
            expect(typeof diagnostic).toBe('string');
            expect(diagnostic).toContain('[non-Error child]');
            expect(diagnostic).not.toContain('fake prototype detail');
            expect(diagnostic).not.toContain('private-context-marker');
        });

        it('bounds cycles, aggregate width, depth, and long messages', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const cyclic = new Error('cyclic cause');
            Object.defineProperty(cyclic, 'cause', { value: cyclic });
            const deep = new Error('deepest');
            let chain = deep;
            for (let index = 0; index < 6; index += 1) {
                chain = new Error(`depth ${index}`, { cause: chain });
            }
            const children = [cyclic, chain, ...Array.from({ length: 5 }, () => new Error('x'.repeat(500)))];
            const outer = new Error('outer', { cause: new AggregateError(children, 'many failures') });

            expect(() => writer.error(outer)).not.toThrow();

            const diagnostic = vi.mocked(console.error).mock.calls[0]?.[2];
            expect(typeof diagnostic).toBe('string');
            expect(diagnostic).toContain('[cycle]');
            expect(diagnostic).toContain('[depth limit]');
            expect(diagnostic).toContain('more errors');
            if (typeof diagnostic !== 'string') {
                throw new TypeError('Missing nested-error diagnostic');
            }
            expect(diagnostic.length).toBeLessThanOrEqual(2048);
        });

        it('does not throw or expose unrelated data when a cause getter fails', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const error = new Error('outer');
            Object.defineProperty(error, 'cause', {
                get() {
                    throw new Error('unrelated getter detail');
                },
            });

            expect(() => writer.error(error)).not.toThrow();

            const call = vi.mocked(console.error).mock.calls[0];
            expect(call?.[0]).toBe('[DEV][ERROR]');
            expect(call?.[1]).toBe(error);
            expect(call?.[2]).toContain('[unreadable cause]');
            expect(call?.[2]).not.toContain('unrelated getter detail');
        });

        it('does not enter an error name getter that logs the same error', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const error = new TypeError('outer', { cause: new Error('inner') });
            let reads = 0;
            Object.defineProperty(error, 'name', {
                get() {
                    reads += 1;
                    if (reads < 65) {
                        writer.error(error);
                    }
                    return 'HostileError';
                },
            });

            writer.error(error);

            expect(reads).toBe(0);
            expect(console.error).toHaveBeenCalledTimes(1);
            expect(console.error).toHaveBeenCalledWith(
                '[DEV][ERROR]',
                error,
                expect.stringContaining('TypeError: outer')
            );
        });

        it('does not enter an error message getter that logs the same error', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const error = new Error('outer', { cause: new Error('inner') });
            let reads = 0;
            Object.defineProperty(error, 'message', {
                get() {
                    reads += 1;
                    if (reads < 65) {
                        writer.error(error);
                    }
                    return 'hidden message';
                },
            });

            writer.error(error);

            expect(reads).toBe(0);
            expect(console.error).toHaveBeenCalledTimes(1);
            const diagnostic = vi.mocked(console.error).mock.calls[0]?.[2];
            expect(diagnostic).toContain('[unreadable message]');
            expect(diagnostic).not.toContain('hidden message');
        });

        it('does not enter a cause getter that logs the same error', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const error = new Error('outer');
            let reads = 0;
            Object.defineProperty(error, 'cause', {
                get() {
                    reads += 1;
                    if (reads < 65) {
                        writer.error(error);
                    }
                    return new Error('hidden cause');
                },
            });

            writer.error(error);

            expect(reads).toBe(0);
            expect(console.error).toHaveBeenCalledTimes(1);
            expect(console.error).toHaveBeenCalledWith(
                '[DEV][ERROR]',
                error,
                expect.stringContaining('[unreadable cause]')
            );
        });

        it('does not enter an aggregate child getter that logs the same error', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const children = [new Error('original child')];
            const error = new AggregateError(children, 'outer');
            let reads = 0;
            Object.defineProperty(children, 0, {
                get() {
                    reads += 1;
                    if (reads < 65) {
                        writer.error(error);
                    }
                    return new Error('hidden child');
                },
            });
            Object.defineProperty(error, 'errors', { value: children });

            writer.error(error);

            expect(reads).toBe(0);
            expect(console.error).toHaveBeenCalledTimes(1);
            expect(console.error).toHaveBeenCalledWith(
                '[DEV][ERROR]',
                error,
                expect.stringContaining('[unreadable error]')
            );
        });

        it('bounds logging reentry from an aggregate array proxy trap', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const error = new AggregateError([], 'outer');
            let reads = 0;
            const children = new Proxy([new Error('inner')], {
                get(target, key, receiver) {
                    reads += 1;
                    if (reads < 65) {
                        writer.error(error);
                    }
                    return Reflect.get(target, key, receiver);
                },
                getOwnPropertyDescriptor(target, key) {
                    writer.error(error);
                    return Reflect.getOwnPropertyDescriptor(target, key);
                },
            });
            Object.defineProperty(error, 'errors', { value: children });

            writer.error(error);

            expect(reads).toBe(0);
            expect(console.error).toHaveBeenCalledTimes(1);
            expect(console.error).toHaveBeenCalledWith('[DEV][ERROR]', error, expect.stringContaining('Error: inner'));
        });

        it('bounds logging reentry from an error prototype proxy trap', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const error = new TypeError('outer', { cause: new Error('inner') });
            const prototype: unknown = Object.getPrototypeOf(error);
            if (prototype === null || typeof prototype !== 'object') {
                throw new TypeError('Missing error prototype');
            }
            let reads = 0;
            Object.setPrototypeOf(
                error,
                new Proxy(prototype, {
                    getOwnPropertyDescriptor(target, key) {
                        if (key === 'name') {
                            reads += 1;
                            writer.error(error);
                        }
                        return Reflect.getOwnPropertyDescriptor(target, key);
                    },
                })
            );

            writer.error(error);

            const call = vi.mocked(console.error).mock.calls[0];
            expect(reads).toBe(1);
            expect(console.error).toHaveBeenCalledTimes(1);
            expect(call?.[1]).toBe(error);
            expect(call?.[2]).toContain('TypeError: outer');
        });

        it('describes a shared child twice without calling it a cycle', () => {
            const writer = createConsoleWriter({ mode: 'development' });
            const shared = new Error('shared failure');
            const error = new AggregateError([shared, shared], 'two effects');

            writer.error(error);

            const diagnostic = vi.mocked(console.error).mock.calls[0]?.[2];
            expect(typeof diagnostic).toBe('string');
            if (typeof diagnostic !== 'string') {
                throw new TypeError('Missing nested-error diagnostic');
            }
            expect(diagnostic.match(/Error: shared failure/g)).toHaveLength(2);
            expect(diagnostic).not.toContain('[cycle]');
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

        it('keeps nested errors on the original two-argument production call', () => {
            const writer = createConsoleWriter({ mode: 'production' });
            const error = new Error('outer', { cause: new Error('inner') });

            writer.error(error);

            expect(console.error).toHaveBeenCalledWith('[Sourdaw][ERROR]', error);
            expect(vi.mocked(console.error).mock.calls[0]).toHaveLength(2);
        });
    });
});
