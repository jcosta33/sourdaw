import { describe, it, expect, beforeEach } from 'vitest';
import { inject } from './inject';
import { Container } from './Container';

describe('inject', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('resolves plain values correctly', () => {
        const myFn = inject({ value: 42 }, (deps) => () => deps.value);
        expect(myFn()).toBe(42);
    });

    it('resolves class-token dependencies correctly', () => {
        class MyService {
            getValue() { return 'hello'; }
        }
        Container.register(MyService, new MyService());

        const myFn = inject({ service: MyService }, (deps) => () => deps.service.getValue());
        expect(myFn()).toBe('hello');
    });

    it('resolves nested injectables correctly', () => {
        const inner = inject({ val: 10 }, (deps) => () => deps.val);
        const outer = inject({ inner }, (deps) => () => deps.inner() * 2);
        
        expect(outer()).toBe(20);
    });

    it('injectable is memoized after first call', () => {
        let factoryCalls = 0;
        const myFn = inject({ val: 1 }, (deps) => {
            factoryCalls++;
            return () => deps.val;
        });

        myFn();
        myFn();
        expect(factoryCalls).toBe(1);
    });

    it('circular dependencies throw with a full chain', () => {
        // We create a cycle where the factory of A calls B, and the factory of B calls A
        // This simulates a cycle during the resolution phase.
        const fnB: any = inject({ a: () => fnA }, (deps) => {
            deps.a()(); // Force resolution of A during B's resolution
            return () => {};
        });

        const fnA: any = inject({ b: () => fnB }, (deps) => {
            deps.b()(); // Force resolution of B during A's resolution
            return () => {};
        });

        expect(() => fnA()).toThrow(/Circular dependency chain detected/);
    });

    it('async dependency value causes failure', () => {
        const myFn = inject({ asyncVal: Promise.resolve(1) }, (deps) => () => deps.asyncVal);
        expect(() => myFn()).toThrow(/Async dependencies are forbidden/);
    });
});