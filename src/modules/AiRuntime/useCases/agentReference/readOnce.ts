/** A reading taken the first time it is asked for and kept for every later ask. */
export function readOnce<Reading>(read: () => Reading): () => Reading {
    let result: { value: Reading } | undefined;
    return () => {
        result ??= { value: read() };
        return result.value;
    };
}
