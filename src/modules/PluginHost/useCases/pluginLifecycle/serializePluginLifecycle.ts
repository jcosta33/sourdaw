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
        result = Promise.resolve().then(() => {
            try {
                return operation();
            } catch (error) {
                const failure =
                    error instanceof Error ? error : new Error('Plugin lifecycle operation failed', { cause: error });
                throw failure;
            }
        });
    }

    const callerResult = result.then((value) => value);
    const completion = result.then(
        () => {
            if (lifecycleTails.get(instanceId) === completion) {
                lifecycleTails.delete(instanceId);
            }
            return undefined;
        },
        (error: unknown) => {
            if (lifecycleTails.get(instanceId) === completion) {
                lifecycleTails.delete(instanceId);
            }
            throw error;
        }
    );
    void completion.catch(() => undefined);
    lifecycleTails.set(instanceId, completion);
    return callerResult;
}
