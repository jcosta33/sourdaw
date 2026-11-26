/**
 * The bus a `send:<busId>` automation target names. The request names that bus to say whose send
 * the level moves ("duck the Drums send to the Drum Bus to -12 dB"), so it is the send's
 * destination, never a second track competing for the figure.
 */
export function getSendLaneBusId(groundedArguments: Record<string, unknown>): string | undefined {
    const parameterId = groundedArguments.parameterId;
    if (typeof parameterId !== 'string' || !parameterId.startsWith('send:')) {
        return undefined;
    }
    return parameterId.slice('send:'.length);
}
