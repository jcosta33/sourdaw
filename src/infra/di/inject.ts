import { Container } from './Container';
import { registrations, cache, testOverrides } from './internal/containerState';
import { type DependencyKey } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TFactoryReturn constraint; DI machinery requires universal function compatibility
type ResolveDependency<TDep> = TDep extends new (...args: any[]) => infer TInstance ? TInstance : TDep;

type ResolveDependencies<TDeps extends Record<string, unknown>> = {
    [TKey in keyof TDeps]: ResolveDependency<TDeps[TKey]>;
};

export type InjectOptions = {
    lazy?: boolean;
};

// Internal metadata shape for injectable functions. `unknown` is used rather than `any`
// so downstream consumers must narrow through the well-typed `inject<TDeps>(...)` overloads.
// The runtime `_factory`/`_deps` are kept intentionally loose — they are only read by the
// DI machinery in this file and by test overrides via `Container.setTestOverride`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DI metadata; loose by design
type InjectableCallable = (...args: any[]) => any;

export type InjectableFunction = InjectableCallable & {
    _isInjectable: boolean;
    _deps: Record<string, unknown>;
    _factory: (deps: Record<string, unknown>) => InjectableCallable;
    _options?: InjectOptions;
};

const resolutionStack = new Set<InjectableFunction>();

function getDependencyToken<TDeps extends Record<string, unknown>>(
    deps: TDeps,
    key: keyof TDeps,
    options?: InjectOptions
): unknown {
    if (!options?.lazy) {
        return deps[key];
    }

    return Object.getOwnPropertyDescriptor(deps, key)?.get ?? deps[key];
}

function getDependencyOverride(dependencyToken: unknown): { hasOverride: boolean; override: unknown } {
    if (testOverrides.has(dependencyToken)) {
        return { hasOverride: true, override: testOverrides.get(dependencyToken) };
    }

    return { hasOverride: false, override: undefined };
}

function assertSyncDependency(key: string, resolved: unknown): unknown {
    if (resolved instanceof Promise) {
        throw new TypeError(`Async dependencies are forbidden: ${key}`);
    }

    return resolved;
}

function resolveInjectedDependency(key: string, rawDependency: unknown): unknown {
    let resolved: unknown;
    if (typeof rawDependency === 'function' && (rawDependency as InjectableFunction)._isInjectable) {
        resolved = rawDependency;
    } else if (
        rawDependency !== null &&
        typeof rawDependency === 'object' &&
        (rawDependency as InjectableFunction)._isInjectable
    ) {
        resolved = rawDependency;
    } else if (registrations.has(rawDependency as DependencyKey<unknown>)) {
        resolved = Container.get(rawDependency as DependencyKey<unknown>);
    } else {
        resolved = rawDependency;
    }

    return assertSyncDependency(key, resolved);
}

export function inject<TDeps extends Record<string, unknown>>(
    deps: TDeps
): <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TFactoryReturn constraint; DI machinery requires universal function compatibility
    TFactoryReturn extends (...args: any[]) => any,
>(
    factory: (resolvedDeps: ResolveDependencies<TDeps>) => TFactoryReturn
) => TFactoryReturn & InjectableFunction;
export function inject<TDeps extends Record<string, unknown>>(
    deps: TDeps,
    options: InjectOptions
): <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TFactoryReturn constraint; DI machinery requires universal function compatibility
    TFactoryReturn extends (...args: any[]) => any,
>(
    factory: (resolvedDeps: ResolveDependencies<TDeps>) => TFactoryReturn
) => TFactoryReturn & InjectableFunction;
export function inject<TDeps extends Record<string, unknown>>(deps: TDeps, options?: InjectOptions) {
    return <
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TFactoryReturn constraint; DI machinery requires universal function compatibility
        TFactoryReturn extends (...args: any[]) => any,
    >(
        factory: (resolvedDeps: ResolveDependencies<TDeps>) => TFactoryReturn
    ): TFactoryReturn & InjectableFunction => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DI invoker args are heterogeneous by design
        const invoker = (...args: any[]) => {
            let cachedInvoker: InjectableCallable | undefined = cache.get(invoker) as InjectableCallable | undefined;
            if (!cachedInvoker) {
                if (resolutionStack.has(invoker as InjectableFunction)) {
                    const chain = Array.from(resolutionStack)
                        .map((item) => item.name || 'injectable')
                        .join(' -> ');
                    throw new Error(`Circular dependency chain detected: ${chain}`);
                }
                resolutionStack.add(invoker as InjectableFunction);

                try {
                    const resolvedDeps: Record<string, unknown> = {};
                    for (const key of Object.keys(deps) as Array<keyof TDeps>) {
                        const dependencyToken = getDependencyToken(deps, key, options);
                        const { hasOverride, override } = getDependencyOverride(dependencyToken);
                        if (hasOverride) {
                            resolvedDeps[String(key)] = assertSyncDependency(String(key), override);
                            continue;
                        }

                        const rawDependency = deps[key];
                        resolvedDeps[String(key)] = resolveInjectedDependency(String(key), rawDependency);
                    }

                    cachedInvoker = factory(resolvedDeps as ResolveDependencies<TDeps>);
                    cache.set(invoker, cachedInvoker);
                } finally {
                    resolutionStack.delete(invoker as InjectableFunction);
                }
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- cachedInvoker is InjectableCallable but return type is any by DI design
            return cachedInvoker(...args);
        };

        invoker._isInjectable = true;
        invoker._deps = deps;
        invoker._factory = factory;
        invoker._options = options;

        // eslint-disable-next-line sourdaw/no-type-assertion-escape -- DI invoker function carries extra properties; cast through unknown is required because the intersection type cannot be structurally proven
        return invoker as unknown as TFactoryReturn & InjectableFunction;
    };
}
