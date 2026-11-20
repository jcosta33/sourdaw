import { digest } from '#/utils/canonicalDigest';

import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import { type MetricGoalProof } from '../models/MetricGoalAdmission';
import { type RetainedCompilation } from '../models/RetainedCompilation';

import { type MetricRequestAuthority } from './metricGoalContractTypes';

type PreviewCompilation = Extract<RetainedCompilation, { kind: 'preview' }>;

function readPreviewProof(
    input: Parameters<typeof collectMetricGoalProof>[0],
    compilation: PreviewCompilation,
    preview: MeasuredPreview
): MetricGoalProof | null {
    const provenance = preview.provenance;
    if (provenance === undefined) {
        return null;
    }
    const receipt = input.receipts.find((entry) => entry.callId === compilation.callId);
    if (
        receipt?.status !== 'success' ||
        receipt.toolName !== 'analysis.measure' ||
        (provenance.origin === 'approval-preview' &&
            (receipt.turn !== 0 || receipt.origin !== 'application-verification')) ||
        (provenance.origin === 'planner' && (receipt.turn < 1 || receipt.origin !== undefined)) ||
        receipt.revision !== compilation.revision ||
        provenance.callId !== receipt.callId ||
        provenance.turn !== receipt.turn ||
        preview.revision !== receipt.revision ||
        input.authorities.some(
            (authority) =>
                authority.origin === 'configured-joint-intake' &&
                provenance.origin === 'planner' &&
                (authority.turn === null || receipt.turn <= authority.turn)
        )
    ) {
        return null;
    }
    return { preview: structuredClone(preview), receiptDigest: digest(receipt) };
}

/** Takes the retained producer projection only after the real raw receipt passed all loop bounds. */
export function collectMetricGoalProof(input: {
    authorities: readonly MetricRequestAuthority[];
    compilations: readonly RetainedCompilation[];
    receipts: readonly ApplicationToolReceipt[];
}): MetricGoalProof[] {
    const proofs: MetricGoalProof[] = [];
    for (const compilation of input.compilations) {
        if (compilation.kind !== 'preview') {
            continue;
        }
        // A several-recipe preview measured each of its prefixes under the one call and receipt.
        for (const preview of [...(compilation.prefixPreviews ?? []), compilation.measuredPreview]) {
            const proof = readPreviewProof(input, compilation, preview);
            if (proof !== null) {
                proofs.push(proof);
            }
        }
    }
    return proofs;
}
