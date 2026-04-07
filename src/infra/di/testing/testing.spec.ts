import { describe, it, expect } from 'vitest';
import { spy } from './spy';
import { createMock } from './createMock';
import { injectDependencies } from './injectDependencies';
import { inject } from '../inject';
import { Container } from '../Container';

describe('DI Testing Helpers', () => {
    it('spy<T>() captures calls with correct typing', () => {
        const mySpy = spy<{ foo: (a: string) => number }>();
        
        mySpy.foo.mockReturnValue(42);
        
        expect(mySpy.foo('hello')).toBe(42);
        expect(mySpy.foo).toHaveBeenCalledWith('hello');
    });

    it('createMock<T>() can build mocks for interface-shaped collaborators', () => {
        const mock = createMock<{ bar: () => string; baz: number }>({ baz: 100 });
        
        mock.bar.mockReturnValue('mocked');
        
        expect(mock.baz).toBe(100);
        expect(mock.bar()).toBe('mocked');
        expect(mock.bar).toHaveBeenCalled();
    });

    it('injectDependencies() overrides dependencies for a test', () => {
        const myDep = inject({}, () => () => 'real');
        const myFn = inject({ myDep }, (deps) => () => deps.myDep());

        const mockDep = () => 'mocked';
        injectDependencies(myFn, { myDep: mockDep });

        expect(myFn()).toBe('mocked');
        
        // Ensure Container was cleared during injectDependencies
        expect(() => Container.get('any')).toThrow();
    });
});