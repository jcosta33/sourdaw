function readRequest(request: IDBRequest<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}

function waitForCompletion(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
    });
}

/** Read matching keys from both stores in one transaction and retain only projected results. */
export async function readIndexedDbRecordPairs<Result>(
    database: IDBDatabase,
    storeNames: readonly [string, string],
    keys: readonly string[],
    project: (first: unknown, second: unknown) => Result
): Promise<Result[]> {
    const transaction = database.transaction([...storeNames], 'readonly');
    const first = transaction.objectStore(storeNames[0]);
    const second = transaction.objectStore(storeNames[1]);
    const reads = keys.map(async (key) => {
        const [firstValue, secondValue] = await Promise.all([
            readRequest(first.get(key)),
            readRequest(second.get(key)),
        ]);
        return project(firstValue, secondValue);
    });
    const [result] = await Promise.all([Promise.all(reads), waitForCompletion(transaction)]);
    return result;
}
