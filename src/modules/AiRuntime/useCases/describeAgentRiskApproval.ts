import { type compileAgentRiskApproval } from './compileAgentRiskApproval';

export function describeAgentRiskApproval(approval: ReturnType<typeof compileAgentRiskApproval>): string {
    const consequences = approval.consequences;
    const consequenceLabels = [
        consequences.audioUpload ? 'audio upload' : null,
        consequences.fileAccess ? 'local file access' : null,
        consequences.remoteGeneration ? 'remote generation' : null,
        consequences.maxImportedAssets > 0 ? `up to ${consequences.maxImportedAssets} imported assets` : null,
        consequences.maxRenderJobs > 0 ? `up to ${consequences.maxRenderJobs} render jobs` : null,
    ].filter((label): label is string => label !== null);
    const consequenceSummary = consequenceLabels.length > 0 ? consequenceLabels.join(', ') : 'none';
    const policyReasons =
        approval.policy.reasons.length > 0 ? `\nAuthority reasons: ${approval.policy.reasons.join(' ')}` : '';
    return `Approval risk: ${approval.policy.risk}\nTrust mode: ${approval.policy.requiredTrustMode}\nCost/data consequences: ${consequenceSummary}${policyReasons}`;
}
