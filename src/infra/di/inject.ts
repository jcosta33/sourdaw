import { Container } from './Container';
import { type DependencyKey } from './types';
import { registrations, cache, testOverrides } from './internal/containerState';

type ResolveDependency<TDep> = TDep extends new (...args: any[]) => infer TInstance ? TInstance : TDep;

type ResolveDependencies<TDeps extends Record<string, unknown>> = {
    [TKey in keyof TDeps]: ResolveDependency<TDeps[TKey]>;
};

export type InjectableFunction = {
    (...args: any[]): any;
    _isInjectable: boolean;
    _deps: Record<string, unknown>;
    _factory: (deps: any) => any;
};

const resolutionStack = new Set<InjectableFunction>();

export const inject =
    <TDeps extends Record<string, unknown>>(deps: TDeps) =>
    <TFactoryReturn extends (...args: any[]) => any>(
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
                    for (const [key, dep] of Object.entries(deps)) {
                        let resolved: unknown;
                        const override = testOverrides.get(dep);

                        if (override !== undefined) {
                            resolved = override;
                        } else if (typeof dep === 'function' && (dep as InjectableFunction)._isInjectable) {
                            resolved = dep;
                        } else if (
                            dep !== null &&
                            typeof dep === 'object' &&
                            (dep as InjectableFunction)._isInjectable
                        ) {
                            resolved = dep;
                        } else if (registrations.has(dep as DependencyKey<unknown>)) {
                            resolved = Container.get(dep as DependencyKey<unknown>);
                        } else {
                            resolved = dep;
                        }

                        if (resolved instanceof Promise) {
                            throw new Error(`Async dependencies are forbidden: ${key}`);
                        }

                        resolvedDeps[key] = resolved;
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

        return invoker as unknown as TFactoryReturn & InjectableFunction;
    };
