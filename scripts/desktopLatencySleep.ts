/**
 * A small, non-blocking delay. Every `scripts/desktopLatency*.ts` poll loop
 * needs the same one-liner; it lived copied four times across those files
 * before this module, which is one more place a future edit could drift the
 * copies apart.
 */
export async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
