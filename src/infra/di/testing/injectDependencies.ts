import { Container } from '../Container';
import { testOverrides } from '../internal/containerState';

import type { InjectableFunction } from '../inject';

export const injectDependencies = <TInjectable extends InjectableFunction, TMocks extends Record<string, unknown>>(
    injectable: TInjectable,
    mocks: TMocks
) => {
    Container.clear();

    for (const key of Object.keys(injectable._deps)) {
        if (!(key in mocks)) {
            throw new Error(`Missing mock for dependency: ${key}`);
        }
    }

    for (const [key, mockValue] of Object.entries(mocks)) {
        const originalDep = injectable._options?.lazy
            ? (Object.getOwnPropertyDescriptor(injectable._deps, key)?.get ?? injectable._deps[key])
            : injectable._deps[key];
        testOverrides.set(originalDep, mockValue);
    }

    return injectable;
};
