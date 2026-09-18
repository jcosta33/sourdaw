/**
 * Frozen agent-campaign requirement contract. One verify command per requirement, verbatim, and the
 * task each requirement belongs to. The manifest generator reads these; nothing else does. The
 * commands are data, not derived text — a rewritten command would silently re-point the evidence a
 * recorded run claims to have produced, so they are transcribed once and changed only deliberately.
 */

export type EvidenceTaskGrouping = {
    id: string;
    gates: readonly string[];
};

/** Verify command per requirement id, exactly as the requirement states it. */
export const EVIDENCE_SUITE_COMMANDS: Readonly<Record<string, string>> = {
    'AC-001':
        'pnpm test:run src/modules/Command/useCases/__tests__/agentControlBoundary.spec.ts src/modules/AiRuntime/useCases/voiceInput/__tests__/localVoiceCommandBoundary.spec.ts && pnpm deps:validate',
    'AC-002': 'pnpm test:run src/modules/Project/useCases/__tests__/agentProjectModelContract.spec.ts',
    'AC-003': 'pnpm test:run src/modules/Project/useCases/__tests__/productionBrief.spec.ts',
    'AC-004': 'pnpm test:run src/modules/Project/useCases/__tests__/semanticProjectQueries.spec.ts',
    'AC-005': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/resolveAgentReference.spec.ts',
    'AC-006': 'pnpm test:run src/modules/Command/useCases/__tests__/versionedCommandContract.spec.ts',
    'AC-007': 'pnpm test:run src/modules/Command/useCases/__tests__/commandRegistryCompleteness.spec.ts',
    'AC-008': 'pnpm test:run src/modules/Command/useCases/__tests__/agentCommandCoverage.spec.ts',
    'AC-009': 'pnpm test:run src/modules/Command/useCases/__tests__/commandBatchContract.spec.ts',
    'AC-010': 'pnpm test:run src/modules/Command/useCases/__tests__/commandBatchPreflight.spec.ts',
    'AC-011': 'pnpm test:run src/modules/CrdtDocument/useCases/__tests__/previewCommandBatch.spec.ts',
    'AC-012': 'pnpm test:run src/modules/Command/useCases/__tests__/semanticProjectDiff.spec.ts',
    'AC-013': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentRiskApproval.spec.ts',
    'AC-014': 'pnpm test:run src/modules/Command/useCases/__tests__/verifiedBatchReceipt.spec.ts',
    'AC-015': 'pnpm test:run src/modules/Command/useCases/__tests__/commandBatchIdempotency.spec.ts',
    'AC-016': 'pnpm test:run src/modules/CrdtDocument/useCases/__tests__/agentConcurrencyAndCompensation.spec.ts',
    'AC-017': 'pnpm test:run src/app/__tests__/agentProtocolVersioning.spec.ts',
    'AC-018':
        'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentExecutionModes.spec.ts src/modules/Command/useCases/__tests__/commandApprovalBoundary.spec.ts',
    'AC-019':
        'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentRunRecovery.spec.ts src/modules/AiRuntime/useCases/__tests__/agentRunWorkLease.spec.ts src/modules/AiRuntime/useCases/__tests__/agentRunControlProjection.spec.ts',
    'AC-020':
        'pnpm test:run src/modules/AiRuntime/useCases/__tests__/cancelAgentRun.spec.ts src/modules/AiRuntime/useCases/__tests__/agentRunWorkLease.spec.ts',
    'AC-021': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/modelProviderProtocol.spec.ts',
    'AC-022': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/applicationOwnedToolLoop.spec.ts',
    'AC-023': 'pnpm test:run src/modules/AiRuntime/repositories/__tests__/webLlmProviderAdapter.spec.ts',
    'AC-024':
        'pnpm test:run src/modules/AiRuntime/useCases/llmOrchestration/backendResolution/__tests__/getBackendChain.spec.ts src/modules/AiRuntime/useCases/llmOrchestration/backendResolution/__tests__/setAiBackendPreference.spec.ts src/modules/AiRuntime/useCases/__tests__/agentRunRecovery.spec.ts src/modules/Preferences/presentations/views/preferences/__tests__/AiSection.spec.tsx',
    'AC-025': 'pnpm test:run src/modules/AiRuntime/repositories/__tests__/openAiProviderAdapter.contract.spec.ts',
    'AC-026': 'pnpm test:run src/modules/AiRuntime/repositories/__tests__/anthropicProviderAdapter.contract.spec.ts',
    'AC-027': 'pnpm test:run src/modules/AiRuntime/repositories/__tests__/providerAdapterConformance.spec.ts',
    'AC-028': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/resolveModelRoute.spec.ts',
    'AC-029': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/modelStreamProtocol.spec.ts',
    'AC-030':
        'cargo test -p sourdaw provider_gateway && pnpm test:run src/modules/AiRuntime/repositories/__tests__/providerSecretBoundary.spec.ts',
    'AC-031': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentDataPolicy.spec.ts',
    'AC-032':
        'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentCostBudget.spec.ts src/modules/AiRuntime/useCases/__tests__/providerRouteView.spec.ts',
    'AC-033': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentToolCatalog.spec.ts',
    'AC-034': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/buildAgentContext.spec.ts',
    'AC-035': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/planAgentRun.spec.ts',
    'AC-036': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/compileArbitraryCommandList.spec.ts',
    'AC-037': 'pnpm test:run src/modules/Command/useCases/__tests__/agentTransformSandbox.spec.ts',
    'AC-038': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentErrorAndSaga.spec.ts',
    'AC-039': 'pnpm test:run src/modules/PluginHost/useCases/__tests__/agentDeviceManifest.spec.ts',
    'AC-040': 'pnpm test:run src/modules/SampleLibrary/useCases/__tests__/agentCatalogSearch.spec.ts',
    'AC-041':
        'pnpm test:run src/modules/AudioEngine/useCases/__tests__/agentGraphBoundary.spec.ts src/modules/AudioEngine/useCases/__tests__/singleAudioContextInvariant.spec.ts && cargo test -p daw-engine audio_deadline',
    'AC-042':
        'pnpm test:run src/modules/AudioRendering/useCases/__tests__/agentOfflineRender.spec.ts src/modules/Arrangement/useCases/freezeBounce/__tests__/agentFreezeRenderReceipt.spec.ts',
    'AC-043': 'pnpm test:run src/modules/AudioAnalysis/useCases/__tests__/agentObjectiveAnalysis.spec.ts',
    'AC-044': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentMediaAutonomyBoundary.spec.ts',
    'AC-045': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/vibeMixingControlLoop.spec.ts',
    'AC-046': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/wholeProjectVibeMixPlan.spec.ts',
    'AC-047': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentGeneratedMediaBoundary.spec.ts',
    'AC-048': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentReconstructionBoundary.spec.ts',
    'AC-049':
        'cargo test -p sourdaw agent_asset_saga && pnpm test:run src/modules/Project/useCases/__tests__/agentAssetFileBoundary.spec.ts',
    'AC-050':
        'pnpm test:run src/modules/WorkspaceShell/presentations/views/__tests__/AgentWorkspace.spec.tsx && pnpm test:e2e tests/e2e/agentWorkspace.spec.ts',
    'AC-051': 'pnpm test:run src/modules/AgentAdapters/useCases/__tests__/externalAgentAdapterConformance.spec.ts',
    'AC-052': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentRunLogRedaction.spec.ts',
    'AC-053': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentResourceLimits.spec.ts',
    'AC-054':
        'pnpm test:run src/modules/AiRuntime/__tests__/agentSystemAcceptance.spec.ts && node --experimental-strip-types scripts/agent-campaign/run-evidence-gate.ts --release --manifest evidence/agent-campaign/manifest.json',
    'AC-055': 'pnpm test:run src/app/__tests__/agentProductionReadiness.spec.ts',
    'AC-056': 'pnpm test:run src/app/__tests__/agentSourceExamples.spec.ts',
    'AC-057':
        'cargo test -p sourdaw provider_gateway_webview_boundary && pnpm test:run src/utils/__tests__/agentWebviewSecurity.spec.ts',
    'AC-058': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentRetentionAndDeletion.spec.ts',
    'AC-059': 'pnpm test:run src/modules/Command/useCases/__tests__/commandExecutionOutcome.spec.ts',
    'AC-060':
        'pnpm test:run src/app/__tests__/agentCampaignBaseline.spec.ts && node --experimental-strip-types scripts/agent-campaign/run-evidence-gate.ts --task TASK-SA-00-protocol-governance --gate AC-060 --manifest evidence/agent-campaign/manifest.json',
    'AC-061': 'pnpm test:run src/modules/AiRuntime/useCases/__tests__/agentDomainPreviewAdapters.spec.ts',
    'AC-062': 'pnpm test:run src/modules/Project/useCases/__tests__/agentDomainQueryConformance.spec.ts',
    'AC-063': 'pnpm test:run src/modules/Command/useCases/__tests__/agentBatchBindings.spec.ts',
};

/**
 * Extra fixtures a suite reads beyond what its verify command names — data a command loads at
 * runtime rather than a path token in its own text, so `commandFixturePaths` can never see it.
 */
export const EVIDENCE_SUITE_DATA: Readonly<Record<string, readonly string[]>> = {
    'AC-054': [
        'evidence/agent-campaign/corpora/development.json',
        'evidence/agent-campaign/corpora/fixture-project.json',
        'evidence/agent-campaign/corpora/held-out.json',
    ],
};

/** Task ownership of the requirement ids. Every id above appears under exactly one task. */
export const EVIDENCE_TASK_GROUPINGS: readonly EvidenceTaskGrouping[] = [
    { id: 'TASK-SA-00-protocol-governance', gates: ['AC-006', 'AC-007', 'AC-008', 'AC-017', 'AC-055', 'AC-060'] },
    { id: 'TASK-SA-01-project-model-and-query', gates: ['AC-002', 'AC-003', 'AC-004', 'AC-005', 'AC-062'] },
    {
        id: 'TASK-SA-02-command-execution',
        gates: [
            'AC-009',
            'AC-010',
            'AC-011',
            'AC-012',
            'AC-013',
            'AC-014',
            'AC-015',
            'AC-016',
            'AC-059',
            'AC-061',
            'AC-063',
        ],
    },
    {
        id: 'TASK-SA-03-runtime-lifecycle',
        gates: ['AC-018', 'AC-019', 'AC-020', 'AC-050', 'AC-052', 'AC-053', 'AC-058'],
    },
    {
        id: 'TASK-SA-04-providers',
        gates: ['AC-021', 'AC-022', 'AC-023', 'AC-024', 'AC-025', 'AC-026', 'AC-027', 'AC-028', 'AC-029', 'AC-030'],
    },
    {
        id: 'TASK-SA-05-context-and-planning',
        gates: ['AC-031', 'AC-032', 'AC-033', 'AC-034', 'AC-035', 'AC-036', 'AC-037', 'AC-038', 'AC-045', 'AC-046'],
    },
    { id: 'TASK-SA-06-devices-assets-audio', gates: ['AC-039', 'AC-040', 'AC-041', 'AC-042', 'AC-043', 'AC-049'] },
    { id: 'TASK-SA-07-media-exclusions', gates: ['AC-044', 'AC-047', 'AC-048'] },
    { id: 'TASK-SA-08-adapters-and-platform', gates: ['AC-001', 'AC-051', 'AC-057'] },
    { id: 'TASK-SA-09-evidence', gates: ['AC-054', 'AC-056'] },
];
