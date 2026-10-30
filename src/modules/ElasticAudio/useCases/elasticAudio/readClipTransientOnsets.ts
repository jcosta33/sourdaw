import { readTransientOnsetSource } from './readTransientOnsetSource';

/** A whole-source local read. The caller admits work before entering this cache boundary. */
export function readClipTransientOnsets(
    input: Parameters<typeof readTransientOnsetSource>[0]
): ReturnType<typeof readTransientOnsetSource> {
    return readTransientOnsetSource(input, 10_000_000);
}
