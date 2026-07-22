const lifecycleTails = new Map<string, Promise<void>>();

export function serializePluginLifecycle<Result>(
    instanceId: string,
    operation: () => Promise<Result>
): Promise<Result> {
    const previous = lifecycleTails.get(instanceId);
    let result: Promise<Result>;
    if (previous) {
        result = previous.then(operation);
    } else {
        try {
            result = operation();
        } catch (error) {
            const failure =
                error instanceof Error ? error : new Error('Plugin lifecycle operation failed', { cause: error });
            result = Promise.reject(failure);
        }
    }

    const completion = result.then(
        () => {
            if (lifecycleTails.get(instanceId) === completion) {
                lifecycleTails.delete(instanceId);
            }
            return undefined;
        },
        () => {
            if (lifecycleTails.get(instanceId) === completion) {
                lifecycleTails.delete(instanceId);
            }
            return undefined;
        }
    );
    lifecycleTails.set(instanceId, completion);
    return result;
}
