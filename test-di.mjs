import { describe, it, expect, beforeEach } from 'vitest';

import { Container } from './src/infra/di/Container.js';
import { inject } from './src/infra/di/inject.js';
import { resetContainerState } from './src/infra/di/internal/containerState.js';

describe('inject', () => {
    beforeEach(() => {
        resetContainerState();
        Container.clear();
    });

    it('should throw with full chain on circular dependencies', () => {
        const fnB: () => void = inject({ a: () => fnA })((deps) => {
            deps.a()();
            return () => {};
        });

        const fnA: () => void = inject({ b: () => fnB })((deps) => {
            deps.b()();
            return () => {};
        });

        expect(() => fnA()).toThrow(/Circular dependency chain detected/);
    });
});
