import { readTransientOnsetSource } from './readTransientOnsetSource';

/** Product detection admits two minutes of stereo 48 kHz independently of analysis queries. */
export function readProductTransientOnsets(
    input: Parameters<typeof readTransientOnsetSource>[0]
): ReturnType<typeof readTransientOnsetSource> {
    return readTransientOnsetSource(input, 12_000_000);
}
