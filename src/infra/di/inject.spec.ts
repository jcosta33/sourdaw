import { describe, it, expect, beforeEach } from 'vitest';
import { inject } from './inject';
import { Container } from './Container';

describe('inject', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('should resolve plain values correctly', () => {
        const myFn = inject({ value: 42 })((deps) => () => deps.value);
        expect(myFn()).toBe(42);
    });

    it('should resolve class-token dependencies correctly', () => {
        class MyService {
            getValue() { return 'hello'; }
        }
        Container.register(MyService, new MyService());

        const myFn = inject({ service: MyService })((deps) => () => deps.service.getValue());
        expect(myFn()).toBe('hello');
    });

    it('should resolve nested injectables correctly', () => {
        const inner = inject({ val: 10 })((deps) => () => deps.val);
        const outer = inject({ inner })((deps) => () => deps.inner() * 2);

        expect(outer()).toBe(20);
    });

    it('should memoize the factory after first call', () => {
        let factoryCalls = 0;
        const myFn = inject({ val: 1 })((deps) => {
            factoryCalls++;
            return () => deps.val;
        });

        myFn();
        myFn();
        expect(factoryCalls).toBe(1);
    });

    it('should throw with full chain on circular dependencies', () => {
        const fnB: any = inject({ a: () => fnA })((deps) => {
            deps.a()();
            return () => {};
        });

        const fnA: any = inject({ b: () => fnB })((deps) => {
            deps.b()();
            return () => {};
        });

        expect(() => fnA()).toThrow(/Circular dependency chain detected/);
    });

    it('should reject async dependency values', () => {
        const myFn = inject({ asyncVal: Promise.resolve(1) })((deps) => () => deps.asyncVal);
        expect(() => myFn()).toThrow(/Async dependencies are forbidden/);
    });
});
