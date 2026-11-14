import { VIBE_BATCH_VALUE_ATTEMPTS_PER_BATCH } from './readVibeRunValueChoiceFit';

/** The brief card's line saying how many hosted calls the run's value choice makes. */
export function describeVibeRunValueChoiceCalls(calls: number): string {
    const unit = (count: number) => `${String(count)} call${count === 1 ? '' : 's'}`;
    return `The run asks the hosted provider for recipe parameter values once per batch: ${unit(calls)}, up to ${unit(calls * VIBE_BATCH_VALUE_ATTEMPTS_PER_BATCH)} if replies need correcting.`;
}
