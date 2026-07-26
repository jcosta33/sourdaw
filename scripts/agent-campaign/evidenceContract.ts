const taskSuffixes = `
protocol-governance command-registry-and-outcomes revision-preview-and-compensation query-brief-and-resolution
local-provider-runtime remote-provider-security run-tool-context-and-planning current-producer-cutover
command-coverage-and-transforms manifests-catalog-and-assets workspace-trust-and-preview render-and-analysis
vibe-mixing-scope-and-planning deferred-media-workflow-guards external-adapters hardening-and-retirement
`
    .trim()
    .split(/\s+/);
function table(source: string): string[][] {
    return source
        .trim()
        .split(/\n|;/)
        .map((row) => row.trim().split('|'));
}
const task = (code: string): string => `TASK-SA-${code.slice(2)}-${taskSuffixes[Number(code.slice(2))]}`;
function numberedIds({ prefix, count }: { prefix: string; count: number }): string[] {
    return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, '0')}`);
}
const boundaryCommands: Record<string, string> = {
    provider: 'pnpm test:run src/modules/AiRuntime/repositories/__tests__/providerSecretBoundary.spec.ts',
    voice: 'pnpm test:run src/modules/AiRuntime/useCases/voiceInput/__tests__/localVoiceCommandBoundary.spec.ts',
};
function detector(code: string): string {
    const suiteId = code === 'media' ? 'deferred-media-boundary' : code.replace('suite:', '');
    if (code === 'media' || code.startsWith('suite:')) {
        return `node --experimental-strip-types scripts/agent-campaign/run-evidence-gate.ts --suite ${suiteId} --manifest evidence/agent-campaign/manifest.json`;
    }
    return boundaryCommands[code] ?? 'pnpm deps:validate';
}
const gateIds = [...numberedIds({ prefix: 'AC', count: 63 }), ...numberedIds({ prefix: 'PG', count: 12 })];
const capabilityRows = table(`
webllm-browser|mandatory|SA04|browser|webgpu-worker|always|Standalone browser route|suite:webllm-real
webllm-tauri|mandatory|SA04|tauri|webgpu-worker|always|Tauri local route|suite:webllm-real
native-local-tauri|unsupported|SA04|tauri|native-process|admittedNativeRuntime|Pending real evidence|suite:native-local-real
openai-tauri|unsupported|SA05|tauri|rust-https|admittedOpenAiProfile|Pending privileged evidence|suite:openai-real
anthropic-tauri|unsupported|SA05|tauri|rust-https|admittedAnthropicProfile|Pending privileged evidence|suite:anthropic-real
compatible-provider-tauri|unsupported|SA05|tauri|rust-https|admittedCompatibleProfile|Pending allowlist evidence|suite:compatible-provider-real
openai-browser|unadmitted|SA05|browser|forbidden|neverInCampaignV1|No browser hosted route|provider
anthropic-browser|unadmitted|SA05|browser|forbidden|neverInCampaignV1|Browser SDK retires|provider
compatible-provider-browser|unadmitted|SA05|browser|forbidden|neverInCampaignV1|No browser BYOK route|provider
voice-local-on-device|unsupported|SA07|tauri|local-stt|provenLocalStt|Requires local proof|voice
voice-browser-speech-recognition|unadmitted|SA07|browser|web-speech|neverInCampaignV1|Execution location unknown|voice
voice-remote-transcription|unadmitted|SA07|any|remote-stt|neverInCampaignV1|Microphone egress forbidden|voice
voice-unknown-execution|unadmitted|SA07|any|unknown|neverInCampaignV1|Unknown execution forbidden|voice
agent-generated-media|unadmitted|SA12|any|forbidden|neverInCampaignV1|Requires governing re-cut|media
bounce-critique|unadmitted|SA12|any|forbidden|neverInCampaignV1|No model listening|media
direct-project-write|unadmitted|SA01|any|forbidden|never|Command authority required|deps
model-audio-input-output|unadmitted|SA12|any|forbidden|neverInCampaignV1|Text and tools only|media
provider-relay|unadmitted|SA05|any|relay|neverInCampaignV1|No server profile|provider
reference-reconstruction|unadmitted|SA13|any|forbidden|neverInCampaignV1|Requires governing re-cut|media
render-listen-adjust|unadmitted|SA12|any|forbidden|neverInCampaignV1|No self-triggered revision|media
sourdaw-agent-server|unadmitted|SA05|any|server|neverInCampaignV1|Serverless-first profile|provider
`);
const capabilityFields = 'id,status,ownerTask,platform,transport,predicate,reason,detectingCommand'.split(',');
const capabilities = capabilityRows.map((row) => ({
    ...Object.fromEntries(capabilityFields.map((field, index) => [field, row[index] ?? ''])),
    ownerTask: task(row[2] ?? ''),
    detectingCommand: detector(row[7] ?? ''),
}));
const ownerRows = table(`
SA07|AC-001;SA03|AC-002,AC-003,AC-004,AC-005
SA01|AC-006,AC-007,AC-009,AC-010,AC-059;SA08|AC-008,AC-037,AC-063
SA02|AC-011,AC-012,AC-014,AC-015,AC-016;SA10|AC-013,AC-050,AC-061
SA00|AC-017,AC-060,PG-005,PG-011
SA06|AC-018,AC-019,AC-020,AC-022,AC-032,AC-033,AC-034,AC-035,AC-036,AC-038
SA04|AC-021,AC-023,AC-024,AC-028,AC-029;SA05|AC-025,AC-026,AC-027,AC-030,AC-031,AC-057
SA09|AC-039,AC-040,AC-049,AC-062;SA11|AC-041,AC-042,AC-043
SA12|AC-044,AC-045,AC-046,AC-047;SA13|AC-048;SA14|AC-051
SA15|AC-052,AC-053,AC-054,AC-055,AC-056,AC-058,PG-001,PG-002,PG-003,PG-004,PG-006,PG-007,PG-008,PG-009,PG-010,PG-012
`);
const ownerByGate = new Map(
    ownerRows.flatMap(([taskCode = '', ids = '']) => ids.split(',').map((gateId) => [gateId, task(taskCode)] as const))
);
const thresholdRows = table(`
acceptedBatchValidation|minimum|1;adapterOverheadP95Ms|maximumExclusive|25;audioDeadlineMisses|maximum|0
cancellationUiMs|maximum|1000;clarifyPrecision|minimum|0.9;clarifyRecall|minimum|0.98
commandSourceOperationCount|exact|130;conflictDetection|exact|1;generalScopeExactness|minimum|0.98
humanAcceptance|minimum|0.8;humanKappa|minimum|0.6;humanRaters|minimum|2
lockDetection|exact|1;mainThreadLongTaskMs|maximum|50;oracleMutations|maximum|0
primaryOutcomeMacroF1|minimum|0.95;protectedScopeExactness|minimum|1;queryAndBatchP95Ms|maximum|1000
regressionRatio|maximum|0.1;reversionDetection|exact|1;safetyOutcomeRecall|minimum|1
staleRevisionDetection|exact|1;unnecessaryAbstention|maximum|0.1;unsafeWriteFalsePositives|maximum|0
`);
const thresholds: Record<string, [string, number]> = Object.fromEntries(
    thresholdRows.map(([id = '', comparator = '', rawValue = '']) => [id, [comparator, Number(rawValue)]])
);
const bindingRows = table(`
AC-008|commandSourceOperationCount;AC-021|adapterOverheadP95Ms
AC-053|cancellationUiMs,mainThreadLongTaskMs,queryAndBatchP95Ms,regressionRatio
AC-054|acceptedBatchValidation,clarifyPrecision,clarifyRecall,conflictDetection,generalScopeExactness,humanAcceptance,humanKappa,humanRaters,lockDetection,oracleMutations,primaryOutcomeMacroF1,protectedScopeExactness,reversionDetection,safetyOutcomeRecall,staleRevisionDetection,unnecessaryAbstention,unsafeWriteFalsePositives
PG-008|audioDeadlineMisses
`);
const thresholdBindings: Record<string, string[]> = Object.fromEntries(
    bindingRows.map(([gateId = '', ids = '']) => [gateId, ids.split(',')])
);
const suiteRows = table(`
webllm-real|SA04|always|webllm-browser|-;native-local-real|SA04|capability.native-local-tauri == admitted|native-local-tauri|-
openai-real|SA05|capability.openai-tauri == admitted|openai-tauri|-;anthropic-real|SA05|capability.anthropic-tauri == admitted|anthropic-tauri|-
compatible-provider-real|SA05|capability.compatible-provider-tauri == admitted|compatible-provider-tauri|-
deferred-media-boundary|SA13|always|model-audio-input-output|-
browser-ui|SA10|always|-|-;packaged-tauri-macos-ui|SA10|platform == darwin|-|-
two-client-collaboration|SA15|always|-|-
audio-deadline|SA11|always|-|audioDeadlineMisses,mainThreadLongTaskMs
performance-and-cost|SA15|always|-|adapterOverheadP95Ms,cancellationUiMs,queryAndBatchP95Ms,regressionRatio
retention-and-deletion|SA15|always|-|-;accessibility|SA15|always|-|-
`);
const suites = suiteRows.map((row) => {
    const [id = '', taskCode = '', requiredWhen = '', rawCapability = '', rawThresholds = ''] = row;
    const capabilityId = rawCapability === '-' ? null : rawCapability;
    const boundThresholds = rawThresholds === '-' ? [] : rawThresholds.split(',');
    return { id, owningTask: task(taskCode), requiredWhen, capabilityId, thresholds: boundThresholds };
});
const suiteIds = suites.map(({ id }) => id);
const gateFields =
    'gateId,owningTask,requirementId,command,arguments,prerequisiteGateIds,requiredWhen,assertions,thresholds,timeoutMs,retryPolicy,outputSchema,evidencePaths'.split(
        ','
    );
const resultFields =
    'resultId,gateOrSuiteId,fixtureIds,status,startedAt,endedAt,exitStatus,stdoutSha256,stderrSha256,assertionTotals,metricSamples,aggregates,rawSamplePaths,environmentMatch,capabilityDecision,reviewerDisposition'.split(
        ','
    );
const fixture = 'fixtureId,path,schemaVersion,sha256,labelVisibility,split,requirementIds,oracleType,classification';
const scanPatterns = 'credentials,authorization-headers,prompts,project-names,lyrics,private-paths,raw-midi,raw-audio';
const forbiddenEvidence =
    'raw-credentials,authorization-headers,raw-prompts,project-names,lyrics,private-paths,raw-midi,raw-audio';
const gateArgumentPrefix = ['--experimental-strip-types', 'scripts/agent-campaign/run-evidence-gate.ts', '--task'];
const gateArgumentSuffix = ['--manifest', 'evidence/agent-campaign/manifest.json'];
const emptyResultFields = Object.fromEntries(
    'startedAt,endedAt,exitStatus,stdoutSha256,stderrSha256,assertionTotals,environmentMatch,capabilityDecision,reviewerDisposition'
        .split(',')
        .map((key) => [key, null])
);
const gateEntries = gateIds.map((gateId) => {
    const owningTask = ownerByGate.get(gateId) ?? '';
    return {
        gateId,
        owningTask,
        requirementId: gateId,
        command: 'node',
        arguments: [...gateArgumentPrefix, owningTask, '--gate', gateId, ...gateArgumentSuffix],
        prerequisiteGateIds: [],
        requiredWhen: 'always',
        assertions: [`requirement ${gateId}`],
        thresholds: thresholdBindings[gateId] ?? [],
        timeoutMs: 120_000,
        retryPolicy: 'never',
        outputSchema: 'agent-campaign-result-v1',
        evidencePaths: [`evidence/agent-campaign/runs/<integrated-head>/${gateId}.json`],
    };
});
const resultEntries = [...gateIds, ...suiteIds].map((gateOrSuiteId) => ({
    resultId: `result.${gateOrSuiteId}`,
    gateOrSuiteId,
    fixtureIds: [],
    status: 'pending',
    ...emptyResultFields,
    metricSamples: [],
    aggregates: {},
    rawSamplePaths: [],
}));
const evidencePolicyTemplate = deepFreeze({
    schemaVersion: 1,
    policyVersion: 2,
    policyTransitionId: 'evidence-policy-v2',
    campaignId: 'sourdaw-agent',
    identity: {
        baselineCommit: 'b5c1dfeede35b52325b69c584db6a629349ae668',
        lockfileSha256: '993d570ce02a3e110ba75bcfff0cab873e32024ba716123735820cff7c0d37d4',
        governingHashes: {
            campaignIndex: '15f084e9138beb2dfe5e4b1bf61448b05a0061839579ecacacdedbb4f976e505',
            changePlan: '3755461ac320f3e5808c205ea162acdc5a7206eb1706b0b24f0f896535c82ed3',
            commandLanguage: 'c5cf46cb24d52742f9280a21a1f10808648bd75fc1f8b7aa810d9cf9a69e0ca1',
            decisions: 'f5b1af17af0ef47cb61b200be1109d9430b6de952d224c2c7fdaeca94d0bae48',
            evidenceAuthority: 'ce550c680528ea9461ef2d7c80bb2233ecbcd397a352699267b3f3fc0871803e',
            inventory: '03ba739b59036e1b15c00138a6f99476cf66ae1138252591f090ee96270eaec3',
            providerRuntime: '8253117bfe50029347f8f2ec43ce3779b81691c21d80ce8e87481eb57821b629',
            sourceBrief: 'bf9822f6a176207b5cd6051489d600b9cc3213145cfe98ea790ee43d3b31014d',
            sourceCoverage: '58e511ec912ac60e4291823d50986b956186e9f5b1e0350ac0ffa6c65ba9f4d2',
            spec: '858eb91d65377063d9cae46a7736a8dccdbd25e87ce0180e599e1f3b7bb220d4',
            specDecisionDisposition: '241b89f503bace13746a0bd3ff382e6594ce377324e5d0fc012795ac692de147',
            taskCollision: '7a16233dd9fed13c07aa5e8908df839d31e79bcb922cc1b95dbb14b52bb2e96e',
            verification: '86181973f6b1abdc51385214778fb2e5f6c38b9b68ec39f254db6921488a0336',
        },
    },
    environment: {
        machineIdSha256: '6346e385a2764e490d9be533aee412d7265f4ed414d096b6d3cf08cbbeedc424',
        platform: 'darwin',
        osVersion: '26.5.2',
        osBuild: '25F84',
        kernelBuild:
            'Darwin Kernel Version 25.5.0: Tue Jun  9 22:28:34 PDT 2026; root:xnu-12377.121.10~1/RELEASE_ARM64_T6041',
        architecture: 'arm64',
        browserVersion: 'Chrome 150.0.7871.186',
        webviewVersion: 'WebKit 21624.2.5.11.8',
        gpuAdapter: 'Apple M4 Pro',
        gpuDriver: 'Apple Metal 4 / Darwin 25.5.0',
        cpu: 'Apple M4 Pro',
        logicalCpuCount: 12,
        memoryBytes: 25_769_803_776,
        audio: { device: 'Mac mini Speakers', sampleRate: 48_000, bufferFrames: 512 },
        tauriVersion: '2.11.5',
        rustVersion: '1.97.0-nightly (17584a181 2026-04-13)',
        nodeVersion: '22.17.0',
        pnpmVersion: '11.6.0',
        powerState: 'AC Power',
        thermalState: 'nominal-unthrottled',
        displayRefreshHz: 120,
        benchmarkConfig: {
            warmIterations: 5,
            subsecondSamples: 100,
            providerSamples: 30,
            coldRestarts: 20,
            audioRuns: 5,
            audioRunMinutes: 10,
            raceRepetitions: 100,
            percentiles: [50, 95, 99],
            confidence: 0.95,
            blockOrder: 'alternating-randomized',
        },
        modelIds: ['Qwen3-4B-q4f16_1-MLC'],
        modelArtifacts: [],
        webLlmArtifactClosure: {
            status: 'pending',
            ownerTask: task('SA04'),
            modelId: 'Qwen3-4B-q4f16_1-MLC',
            modelRepositoryUrl: 'https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC',
            modelLibraryUrl:
                'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-4B-q4f16_1_cs1k-webgpu.wasm',
            requiredCategories: ['config', 'tokenizer', 'weights', 'wasm'],
            missingDigestCategories: ['config', 'tokenizer', 'weights', 'wasm'],
            authorityMismatch:
                'Mutable upstream aliases have no repository-owned immutable revision and digest closure',
        },
        providerApiVersions: {
            webllm: '0.2.84',
            'openai-responses': 'unadmitted',
            'anthropic-messages': 'unadmitted',
            'openai-compatible': 'unadmitted',
        },
        redactedEndpointOrigin: null,
    },
    capabilities,
    inventories: {
        fixtures: {
            requiredFields: fixture.split(','),
            entries: [],
        },
        gates: { requiredFields: gateFields, entries: gateEntries },
        results: { requiredFields: resultFields, entries: resultEntries },
    },
    suites,
    thresholds,
    redaction: {
        patternsScanned: scanPatterns.split(','),
        retainedFields: 'ids,sizes,hashes,timings,statuses,metrics,redacted-origin'.split(','),
        retentionDurationDays: 30,
        deletionOwner: task('SA15'),
        absenceGateId: 'PG-009',
        forbiddenOrdinaryEvidence: forbiddenEvidence.split(','),
    },
});
function deepFreeze<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null) {
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
        Object.freeze(value);
    }
    return value;
}
export type EvidenceRunIdentity = { observedCommit: string; observedDirty: boolean; capturedAt: string };
export type EvidencePolicy = typeof evidencePolicyTemplate;

export const createEvidencePolicy = (): EvidencePolicy => deepFreeze(structuredClone(evidencePolicyTemplate));
