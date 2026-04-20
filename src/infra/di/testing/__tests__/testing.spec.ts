import { describe, it, expect, beforeEach } from 'vitest';

import { Container } from '../../Container';
import { inject } from '../../inject';
import { resetContainerState } from '../../internal/containerState';
import { createMock } from '../createMock';
import { injectDependencies } from '../injectDependencies';
import { spy } from '../spy';

describe('DI Testing Helpers', () => {
    beforeEach(() => {
        resetContainerState();
    });

    it('should capture calls with correct typing via spy()', () => {
        const mySpy = spy<{ foo: (a: string) => number }>();

        mySpy.foo.mockReturnValue(42);

        expect(mySpy.foo('hello')).toBe(42);
        expect(mySpy.foo).toHaveBeenCalledWith('hello');
    });

    it('should build mocks for interface-shaped collaborators via createMock()', () => {
        const mock = createMock<{ bar: () => string; baz: number }>({ baz: 100 });

        mock.bar.mockReturnValue('mocked');

        expect(mock.baz).toBe(100);
        expect(mock.bar()).toBe('mocked');
        expect(mock.bar).toHaveBeenCalled();
    });

    it('should override dependencies for a test via injectDependencies()', () => {
        const myDep = inject({})(() => () => 'real');
        const myFn = inject({ myDep })((deps) => () => deps.myDep());

        const mockDep = () => 'mocked';
        injectDependencies(myFn, { myDep: mockDep });

        expect(myFn()).toBe('mocked');

        expect(() => Container.get('any')).toThrow();
    });

    it('should override lazy getter dependencies without invoking their getters', () => {
        let getterCalls = 0;
        const myFn = inject(
            {
                get myDep() {
                    getterCalls++;
                    return () => 'real';
                },
            },
            { lazy: true }
        )((deps) => () => deps.myDep());

        injectDependencies(myFn, { myDep: () => 'mocked' });

        expect(getterCalls).toBe(0);
        expect(myFn()).toBe('mocked');
        expect(getterCalls).toBe(0);
    });
});
