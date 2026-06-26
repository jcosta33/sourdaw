/**
 * Order two incremental-chunk keys by their full ordering token.
 *
 * Keys are built as `${docId}:incremental:${Date.now()}-${seq.toString(36)}`
 * (see `saveIncrementalToIdb.ts`). The trailing token is `${millis}-${seqBase36}`,
 * where `seq` is a strictly-increasing counter added precisely to disambiguate
 * two chunks written within the same millisecond.
 *
 * A previous comparator parsed only `parseInt(token, 10)`, which stops at the
 * `-` and discards the `seq` tiebreaker — so same-millisecond chunks compared
 * equal and their replay order fell back to sort stability + IDB iteration
 * order rather than the monotonic `seq` the writer encodes. This parses the
 * whole compound token: millis first, then `seq` (base 36) as the tiebreaker.
 */
export function compareIncrementalKeys(keyA: string, keyB: string): number {
    const tokenA = keyA.split(':').pop() ?? '';
    const tokenB = keyB.split(':').pop() ?? '';

    const dashA = tokenA.indexOf('-');
    const dashB = tokenB.indexOf('-');

    const millisA = parseInt(dashA === -1 ? tokenA : tokenA.slice(0, dashA), 10) || 0;
    const millisB = parseInt(dashB === -1 ? tokenB : tokenB.slice(0, dashB), 10) || 0;
    if (millisA !== millisB) {
        return millisA - millisB;
    }

    const seqA = dashA === -1 ? 0 : parseInt(tokenA.slice(dashA + 1), 36) || 0;
    const seqB = dashB === -1 ? 0 : parseInt(tokenB.slice(dashB + 1), 36) || 0;
    return seqA - seqB;
}
