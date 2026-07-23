import { afterEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';

import { RuntimeLogger, setRuntimeLogger } from '../runtimeLogger';

describe('setRuntimeLogger', () => {
    afterEach(() => {
        Container.clear();
    });

    it('registers the given logger implementation on the Container so RuntimeLogger.get() resolves it', () => {
        const logger: RuntimeLogger = {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
        };

        setRuntimeLogger(logger);

        expect(Container.get(RuntimeLogger)).toBe(logger);
    });

    it('overwrites a previously set logger', () => {
        const first: RuntimeLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
        const second: RuntimeLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

        setRuntimeLogger(first);
        setRuntimeLogger(second);

        expect(Container.get(RuntimeLogger)).toBe(second);
    });
});
