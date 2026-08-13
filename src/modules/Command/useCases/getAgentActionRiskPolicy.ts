import { getAppActionExecutionPolicy } from './getAppActionExecutionPolicy';

type AgentRiskPolicyInput = {
    operationTypes: readonly string[];
    authorityEffects?: {
        master?: boolean;
        routing?: boolean;
        tempo?: boolean;
    };
    consequences?: {
        audioUpload?: boolean;
        fileAccess?: boolean;
        maxImportedAssets?: number;
        maxRenderJobs?: number;
        remoteGeneration?: boolean;
    };
    signals?: {
        ambiguous?: boolean;
        capabilityDegraded?: boolean;
        stale?: boolean;
        unexpectedlyBroad?: boolean;
    };
};

const riskRank = {
    'read-only': 0,
    'bounded-reversible': 1,
    'broad-reversible': 2,
    'destructive-reversible': 3,
    'authority-sensitive': 4,
    'external-effect': 5,
    unclassified: 6,
} as const;

function getRequiredTrustMode(risk: keyof typeof riskRank, operationTypes: readonly string[]) {
    if (risk === 'read-only') {
        return 'analyze-only' as const;
    }
    if (
        operationTypes.length > 0 &&
        operationTypes.every((operationType) => operationType === 'createDrumPreviewBranches')
    ) {
        return 'create-branch' as const;
    }
    if (risk === 'bounded-reversible' || risk === 'broad-reversible' || risk === 'authority-sensitive') {
        return 'apply-reversible' as const;
    }
    if (risk === 'destructive-reversible') {
        return 'replace-selection' as const;
    }
    return 'destructive-commit' as const;
}

export function getAgentActionRiskPolicy(input: AgentRiskPolicyInput) {
    const policies = input.operationTypes.map(getAppActionExecutionPolicy);
    let highestRisk = policies.reduce<keyof typeof riskRank>(
        (highest, policy) => (riskRank[policy.risk] > riskRank[highest] ? policy.risk : highest),
        'read-only'
    );
    const reasons = policies.flatMap((policy) => (policy.reason ? [policy.reason] : []));
    const hardRejectionReasons: string[] = [];
    if (input.signals?.ambiguous) {
        hardRejectionReasons.push('The requested authority is ambiguous.');
    }
    if (input.signals?.stale) {
        hardRejectionReasons.push('The proposed authority is stale.');
    }
    if (input.signals?.capabilityDegraded) {
        hardRejectionReasons.push('The required capability is degraded or unavailable.');
    }
    if (input.signals?.unexpectedlyBroad && riskRank[highestRisk] < riskRank['broad-reversible']) {
        highestRisk = 'broad-reversible';
        reasons.push('The resolved operation is broader than its bounded default.');
    }
    const consequences = input.consequences;
    const hasExternalDataEffect =
        consequences?.audioUpload === true ||
        consequences?.fileAccess === true ||
        consequences?.remoteGeneration === true ||
        (consequences?.maxImportedAssets ?? 0) > 0;
    if (hasExternalDataEffect && riskRank[highestRisk] < riskRank['external-effect']) {
        highestRisk = 'external-effect';
        reasons.push('The operation can transfer, import, or access data outside project truth.');
    }
    const hasAuthorityEffect =
        input.authorityEffects?.master === true ||
        input.authorityEffects?.routing === true ||
        input.authorityEffects?.tempo === true;
    if (hasAuthorityEffect && riskRank[highestRisk] < riskRank['authority-sensitive']) {
        highestRisk = 'authority-sensitive';
        reasons.push('The operation changes master, tempo, or routing authority.');
    }
    const hasMaterialCost = (consequences?.maxRenderJobs ?? 0) > 0;
    if (hasMaterialCost && riskRank[highestRisk] < riskRank['authority-sensitive']) {
        highestRisk = 'authority-sensitive';
        reasons.push('The operation can consume bounded render resources.');
    }
    if (hardRejectionReasons.length > 0) {
        return {
            decision: 'reject' as const,
            reasons: [...reasons, ...hardRejectionReasons],
            requiredTrustMode: 'destructive-commit' as const,
            risk: highestRisk,
        };
    }
    const requiresRegistryConfirmation = policies.some((policy) => policy.requiresConfirmation);
    const requiresBatchConfirmation = input.operationTypes.length > 1;
    const requiresContextualConfirmation =
        hasExternalDataEffect || hasAuthorityEffect || hasMaterialCost || input.signals?.unexpectedlyBroad;
    let decision: 'allow' | 'confirm' = 'allow';
    if (requiresRegistryConfirmation || requiresBatchConfirmation || requiresContextualConfirmation) {
        decision = 'confirm';
    }
    return {
        decision,
        reasons: [...new Set(reasons)],
        requiredTrustMode: getRequiredTrustMode(highestRisk, input.operationTypes),
        risk: highestRisk,
    };
}
