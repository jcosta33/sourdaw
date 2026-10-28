import { digest } from '#/utils/canonicalDigest';

import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type MetricGoalProof } from '../models/MetricGoalAdmission';
import { type RetainedCompilation } from '../models/RetainedCompilation';

import { type MetricRequestAuthority } from './metricGoalContractTypes';

/** Takes the retained producer projection only after the real raw receipt passed all loop bounds. */
export function collectMetricGoalProof(input: {
    authorities: readonly MetricRequestAuthority[];
    compilations: readonly RetainedCompilation[];
    receipts: readonly ApplicationToolReceipt[];
}): MetricGoalProof[] {
    const proofs: MetricGoalProof[] = [];
    for (const compilation of input.compilations) {
        if (compilation.kind !== 'preview' || compilation.measuredPreview.provenance === undefined) {
            continue;
        }
        const preview = compilation.measuredPreview;
        const provenance = preview.provenance;
        if (provenance === undefined) {
            continue;
        }
        const receipt = input.receipts.find((entry) => entry.callId === compilation.callId);
        if (
            receipt?.status !== 'success' ||
            receipt.toolName !== 'analysis.measure' ||
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
            continue;
        }
        proofs.push({ preview: structuredClone(preview), receiptDigest: digest(receipt) });
    }
    return proofs;
}
