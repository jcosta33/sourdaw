import { Container } from './Container';
import { type DependencyKey } from './types';
import { registrations, cache, testOverrides } from './internal/containerState';

type ResolveDependency<TDep> = TDep extends new (...args: any[]) => infer TInstance ? TInstance : TDep;

type ResolveDependencies<TDeps extends Record<string, unknown>> = {
    [TKey in keyof TDeps]: ResolveDependency<TDeps[TKey]>;
};

export type InjectOptions = {
    lazy?: boolean;
};

export type InjectableFunction = {
    (...args: any[]): any;
    _isInjectable: boolean;
    _deps: Record<string, unknown>;
    _factory: (deps: any) => any;
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
        throw new Error(`Async dependencies are forbidden: ${key}`);
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
): <TFactoryReturn extends (...args: any[]) => any>(
    factory: (resolvedDeps: ResolveDependencies<TDeps>) => TFactoryReturn
) => TFactoryReturn & InjectableFunction;
export function inject<TDeps extends Record<string, unknown>>(
    deps: TDeps,
    options: InjectOptions
): <TFactoryReturn extends (...args: any[]) => any>(
    factory: (resolvedDeps: ResolveDependencies<TDeps>) => TFactoryReturn
) => TFactoryReturn & InjectableFunction;
export function inject<TDeps extends Record<string, unknown>>(deps: TDeps, options?: InjectOptions) {
    return <TFactoryReturn extends (...args: any[]) => any>(
        factory: (resolvedDeps: ResolveDependencies<TDeps>) => TFactoryReturn
    ): TFactoryReturn & InjectableFunction => {
        const invoker = (...args: any[]) => {
            let cachedInvoker = cache.get(invoker);
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
            return cachedInvoker(...args);
        };

        invoker._isInjectable = true;
        invoker._deps = deps;
        invoker._factory = factory;
        invoker._options = options;

        return invoker as unknown as TFactoryReturn & InjectableFunction;
    };
}
