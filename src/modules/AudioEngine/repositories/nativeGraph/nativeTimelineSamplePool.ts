import { type AudioGraphCommand } from '../../models/AudioGraphBackend';

import { type NativeGraphTransport } from './nativeGraphTransport';
import { nativeTimelineMaterialLeases } from './nativeTimelineMaterialLeases';

type MaterialOwner = ReturnType<typeof nativeTimelineMaterialLeases.captureOwner>;
type PrimeConsumer = ReturnType<typeof nativeTimelineMaterialLeases.createConsumer>;
const primes = new WeakMap<MaterialOwner, PrimeConsumer>();

export type RegisterNativeTimelineSamplesInput = Readonly<{
    transport: NativeGraphTransport;
    commands: readonly AudioGraphCommand[];
    owner?: MaterialOwner;
}>;

export type RegisterNativeTimelineSamplesResult =
    | Readonly<{ outcome: 'registered'; sampleIds: readonly string[] }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

/** Prime is a real consumer; its identity memo cannot confer native residency. */
export async function registerNativeTimelineSamples(
    input: RegisterNativeTimelineSamplesInput
): Promise<RegisterNativeTimelineSamplesResult> {
    const owner = input.owner ?? nativeTimelineMaterialLeases.captureOwner();
    try {
        let consumer = primes.get(owner);
        if (!consumer) {
            consumer = nativeTimelineMaterialLeases.createConsumer(input.transport, owner);
            primes.set(owner, consumer);
        }
        const captured = consumer;
        const publications = captured.capture(input.commands);
        return await captured.run(async () => {
            const claim = await captured.prepare(input.commands, true, publications);
            try {
                await captured.accept(claim);
                return { outcome: 'registered', sampleIds: claim.sampleIds };
            } catch (error) {
                await captured.decline(claim);
                throw error;
            }
        });
    } catch (error) {
        return { outcome: 'declined', reason: error instanceof Error ? error.message : String(error) };
    }
}
