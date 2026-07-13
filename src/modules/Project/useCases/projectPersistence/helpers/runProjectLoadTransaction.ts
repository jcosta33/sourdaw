let projectLoadQueue: Promise<void> = Promise.resolve();

type RunProjectLoadTransactionInput<ResultValue> = {
    load: () => Promise<ResultValue>;
};

type RunProjectLoadTransactionOutput<ResultValue> = Promise<ResultValue>;

export function runProjectLoadTransaction<ResultValue>({
    load,
}: RunProjectLoadTransactionInput<ResultValue>): RunProjectLoadTransactionOutput<ResultValue> {
    const result = projectLoadQueue.then(load, load);
    projectLoadQueue = result.then(
        () => undefined,
        () => undefined
    );
    return result;
}
