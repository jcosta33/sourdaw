import { digest } from '#/utils/canonicalDigest';

import { type MeasuredMetricEntry } from '../models/MeasuredPreview';
import { type VibeRunExpectedDelta, type VibeRunSilentRange } from '../models/VibeRunPlan';

import { type readVibeRunInitialReceipt } from './readVibeRunInitialReceipt';

type TargetFigures = Readonly<Partial<Record<string, MeasuredMetricEntry>>>;
type InitialReceipt = NonNullable<ReturnType<typeof readVibeRunInitialReceipt>>;

function readsSilent(entry: MeasuredMetricEntry | undefined): boolean {
    return entry?.status === 'unavailable' && entry.reason === 'silent';
}

/**
 * A target is silent over a range only when exactly one exact-range measurement answers for it there
 * and every metric its recipes expect to move reads `unavailable: silent`, band-wise ones included.
 * Two candidates are ambiguous, and a range where any expected metric is measured or unavailable for
 * another reason is not silence: both still refuse, as a missing figure does.
 */
export function isSilentVibeRunCell(
    candidates: readonly TargetFigures[],
    expectedDeltas: readonly Pick<VibeRunExpectedDelta, 'metric'>[]
): boolean {
    const [figures] = candidates;
    return (
        candidates.length === 1 &&
        figures !== undefined &&
        expectedDeltas.length > 0 &&
        expectedDeltas.every((delta) => readsSilent(figures[delta.metric]))
    );
}

/**
 * A stored silence record still stands: its receipt is the one exact-range receipt of the source
 * revision that measured the target there, it lists every expected metric, its digest matches, and
 * the target reads silent in it.
 */
export function recordedSilenceHolds(input: {
    record: VibeRunSilentRange;
    expectedDeltas: readonly Pick<VibeRunExpectedDelta, 'metric'>[];
    receipts: readonly InitialReceipt[];
    sourceRevision: string;
}): boolean {
    const { record } = input;
    const sameRange = (receipt: InitialReceipt) =>
        receipt.data.range.startBeat === record.range.startBeat &&
        receipt.data.range.endBeat === record.range.endBeat &&
        receipt.data.range.sectionId === record.range.sectionId;
    const receipt = input.receipts.find((candidate) => candidate.callId === record.receiptCallId);
    if (
        receipt === undefined ||
        digest(receipt) !== record.receiptDigest ||
        receipt.revision !== input.sourceRevision ||
        !sameRange(receipt) ||
        input.expectedDeltas.some((delta) => !receipt.data.metrics.includes(delta.metric))
    ) {
        return false;
    }
    const candidates = input.receipts.filter(
        (candidate) =>
            sameRange(candidate) && candidate.data.targets.some((target) => target.targetId === record.targetId)
    );
    return (
        candidates.length === 1 &&
        candidates[0]?.callId === receipt.callId &&
        isSilentVibeRunCell(
            receipt.data.targets
                .filter((target) => target.targetId === record.targetId)
                .map((target) => target.measurements),
            input.expectedDeltas
        )
    );
}
