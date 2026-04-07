import { Container } from './Container';
import { registrations, cache, testOverrides } from './internal/containerState';

export type InjectableFunction = {
    (...args: any[]): any;
    _isInjectable: boolean;
    _deps: Record<string, any>;
    _factory: (deps: any) => any;
};

const resolutionStack = new Set<any>();

export const inject = <TDeps extends Record<string, any>, TFactoryReturn extends (...args: any[]) => any>(
    deps: TDeps,
    factory: (resolvedDeps: { [K in keyof TDeps]: any }) => TFactoryReturn
) => {
    const invoker = (...args: any[]) => {
        let cachedInvoker = cache.get(invoker);
        if (!cachedInvoker) {
            if (resolutionStack.has(invoker)) {
                const chain = Array.from(resolutionStack).map(i => i.name || 'injectable').join(' -> ');
                throw new Error(`Circular dependency chain detected: ${chain}`);
            }
            resolutionStack.add(invoker);

            try {
                const resolvedDeps: Record<string, any> = {};
                for (const [key, dep] of Object.entries(deps)) {
                    let resolved: any;
                    const override = testOverrides.get(dep);
                    
                    if (override !== undefined) {
                        resolved = override;
                    } else if (typeof dep === 'function' && (dep as any)._isInjectable) {
                        resolved = dep;
                    } else if (dep && typeof dep === 'object' && (dep as any)._isInjectable) {
                        resolved = dep;
                    } else if (registrations.has(dep)) {
                        resolved = Container.get(dep);
                    } else {
                        resolved = dep;
                    }

                    if (resolved instanceof Promise) {
                        throw new Error(`Async dependencies are forbidden: ${key}`);
                    }
                    
                    resolvedDeps[key] = resolved;
                }

                cachedInvoker = factory(resolvedDeps as any);
                cache.set(invoker, cachedInvoker);
            } finally {
                resolutionStack.delete(invoker);
            }
        }
        return cachedInvoker(...args);
    };

    invoker._isInjectable = true;
    invoker._deps = deps;
    invoker._factory = factory;

    return invoker as unknown as TFactoryReturn & InjectableFunction;
};