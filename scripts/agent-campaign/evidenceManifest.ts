const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9]+(?:[-._][A-Za-z0-9]+)*$/;

const GOVERNING_HASHES: unknown = JSON.parse(
    '{"campaignIndex":"15f084e9138beb2dfe5e4b1bf61448b05a0061839579ecacacdedbb4f976e505","changePlan":"3755461ac320f3e5808c205ea162acdc5a7206eb1706b0b24f0f896535c82ed3","commandLanguage":"c5cf46cb24d52742f9280a21a1f10808648bd75fc1f8b7aa810d9cf9a69e0ca1","decisions":"f5b1af17af0ef47cb61b200be1109d9430b6de952d224c2c7fdaeca94d0bae48","evidenceAuthority":"ce550c680528ea9461ef2d7c80bb2233ecbcd397a352699267b3f3fc0871803e","inventory":"03ba739b59036e1b15c00138a6f99476cf66ae1138252591f090ee96270eaec3","providerRuntime":"8253117bfe50029347f8f2ec43ce3779b81691c21d80ce8e87481eb57821b629","sourceBrief":"bf9822f6a176207b5cd6051489d600b9cc3213145cfe98ea790ee43d3b31014d","sourceCoverage":"58e511ec912ac60e4291823d50986b956186e9f5b1e0350ac0ffa6c65ba9f4d2","spec":"858eb91d65377063d9cae46a7736a8dccdbd25e87ce0180e599e1f3b7bb220d4","specDecisionDisposition":"241b89f503bace13746a0bd3ff382e6594ce377324e5d0fc012795ac692de147","taskCollision":"7a16233dd9fed13c07aa5e8908df839d31e79bcb922cc1b95dbb14b52bb2e96e","verification":"86181973f6b1abdc51385214778fb2e5f6c38b9b68ec39f254db6921488a0336"}'
);
const SUITES =
    'webllm-real,native-local-real,openai-real,anthropic-real,compatible-provider-real,deferred-media-boundary,browser-ui,packaged-tauri-macos-ui,two-client-collaboration,audio-deadline,performance-and-cost,retention-and-deletion,accessibility'.split(
        ','
    );
const THRESHOLD_IDS =
    'acceptedBatchValidation,adapterOverheadP95Ms,audioDeadlineMisses,cancellationUiMs,clarifyPrecision,clarifyRecall,commandSourceOperationCount,conflictDetection,generalScopeExactness,humanAcceptance,humanKappa,humanRaters,mainThreadLongTaskMs,oracleMutations,primaryOutcomeMacroF1,protectedScopeExactness,queryAndBatchP95Ms,regressionRatio,safetyOutcomeRecall,unnecessaryAbstention,unsafeWriteFalsePositives'.split(
        ','
    );
const FROZEN_THRESHOLDS: unknown = JSON.parse(
    '{"acceptedBatchValidation":["minimum",1],"adapterOverheadP95Ms":["maximumExclusive",25],"audioDeadlineMisses":["maximum",0],"cancellationUiMs":["maximum",1000],"clarifyPrecision":["minimum",0.9],"clarifyRecall":["minimum",0.98],"commandSourceOperationCount":["exact",130],"conflictDetection":["minimum",1],"generalScopeExactness":["minimum",0.98],"humanAcceptance":["minimum",0.8],"humanKappa":["minimum",0.6],"humanRaters":["minimum",2],"mainThreadLongTaskMs":["maximum",50],"oracleMutations":["maximum",0],"primaryOutcomeMacroF1":["minimum",0.95],"protectedScopeExactness":["minimum",1],"queryAndBatchP95Ms":["maximum",1000],"regressionRatio":["maximum",0.1],"safetyOutcomeRecall":["minimum",1],"unnecessaryAbstention":["maximum",0.1],"unsafeWriteFalsePositives":["maximum",0]}'
);
const UNADMITTED = new Set(
    'agent-generated-media,bounce-critique,direct-project-write,model-audio-input-output,provider-relay,reference-reconstruction,render-listen-adjust,sourdaw-agent-server'.split(
        ','
    )
);
const FIELDS = {
    manifest: 'schemaVersion,campaignId,identity,environment,capabilities,inventories,suites,thresholds'.split(','),
    identity: 'baselineCommit,integratedCommit,dirty,buildProvenance,lockfileSha256,governingHashes'.split(','),
    environment:
        'platform,architecture,browser,webview,webGpu,cpu,logicalCpuCount,memoryBytes,audio,tauri,rust,node,pnpm,modelIds,modelArtifacts,providerApiVersions,redactedEndpointOrigin'.split(
            ','
        ),
    capability: 'id,status,ownerTask,predicate,reason,detectingCommand'.split(','),
    fixture: 'fixtureId,path,schemaVersion,sha256,labelVisibility,split,requirementIds,oracleType,classification'.split(
        ','
    ),
    gate: 'gateId,owningTask,requirementId,command,arguments,prerequisiteGateIds,requiredWhen,assertions,thresholds,timeoutMs,retryPolicy,outputSchema,evidencePaths'.split(
        ','
    ),
    result: 'resultId,gateOrSuiteId,fixtureIds,status,startedAt,endedAt,exitStatus,stdoutSha256,stderrSha256,assertionTotals,metricSamples,aggregates,rawSamplePaths,environmentMatch,capabilityDecision,reviewerDisposition'.split(
        ','
    ),
    suite: 'id,owningTask,requiredWhen,capabilityId'.split(','),
} as const;
const KINDS: Record<string, string> = {
    capabilities: 'id:s,status:s,ownerTask:s,predicate:s,reason:s,detectingCommand:s',
    fixtures:
        'fixtureId:s,path:s,schemaVersion:n,sha256:s,labelVisibility:s,split:s,requirementIds:a,oracleType:s,classification:s',
    gates: 'gateId:s,owningTask:s,requirementId:s,command:s,arguments:a,prerequisiteGateIds:a,requiredWhen:s,assertions:a,thresholds:a,timeoutMs:n,retryPolicy:s,outputSchema:s,evidencePaths:a',
    results:
        'resultId:s,gateOrSuiteId:s,fixtureIds:a,status:s,startedAt:sz,endedAt:sz,exitStatus:nz,stdoutSha256:sz,stderrSha256:sz,assertionTotals:oz,metricSamples:a,aggregates:o,rawSamplePaths:a,environmentMatch:bz,capabilityDecision:sz,reviewerDisposition:sz',
    suites: 'id:s,owningTask:s,requiredWhen:s,capabilityId:sz',
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonObject, expected: readonly string[], path: string, errors: string[]): void {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.join('\0') !== wanted.join('\0')) {
        errors.push(`${path} fields must be exactly: ${wanted.join(', ')}`);
    }
}

function arrayOfObjects(value: unknown, path: string, errors: string[]): JsonObject[] {
    if (!Array.isArray(value) || value.some((entry) => !isObject(entry))) {
        errors.push(`${path} must be an array of objects`);
        return [];
    }
    return value.filter(isObject);
}

function stringArray(value: unknown, path: string, errors: string[]): string[] {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        errors.push(`${path} must be an array of strings`);
        return [];
    }
    return value.filter((entry): entry is string => typeof entry === 'string');
}

function uniqueIds(entries: JsonObject[], key: string, path: string, errors: string[]): Set<string> {
    const ids = new Set<string>();
    for (const entry of entries) {
        const id = entry[key];
        if (typeof id !== 'string' || !ID.test(id)) {
            errors.push(`${path}.${key} contains a malformed ID`);
        } else if (ids.has(id)) {
            errors.push(`${path}.${key} contains duplicate ID ${id}`);
        } else {
            ids.add(id);
        }
    }
    return ids;
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function jsonKind(value: unknown): string {
    if (value === null) {
        return 'z';
    }
    if (Array.isArray(value)) {
        return 'a';
    }
    switch (typeof value) {
        case 'object':
            return 'o';
        case 'number':
            return 'n';
        case 'boolean':
            return 'b';
        case 'string':
            return 's';
        case 'bigint':
        case 'function':
        case 'symbol':
        case 'undefined':
            return 'u';
    }
    return 'u';
}

function validateKinds(value: JsonObject, schema: string, path: string, errors: string[]): void {
    for (const token of schema.split(',')) {
        const [key = '', allowed = ''] = token.split(':');
        if (!allowed.includes(jsonKind(value[key]))) {
            errors.push(`${path}.${key} has invalid type`);
        }
    }
}

function kindSchema(name: string): string {
    return KINDS[name] ?? '';
}

function validateInventory(
    inventory: unknown,
    name: string,
    requiredFields: readonly string[],
    idKey: string,
    errors: string[]
): JsonObject[] {
    if (!isObject(inventory)) {
        errors.push(`inventories.${name} must be an object`);
        return [];
    }
    exactKeys(inventory, ['requiredFields', 'entries'], `inventories.${name}`, errors);
    if (!sameJson(inventory.requiredFields, requiredFields)) {
        errors.push(`inventories.${name}.requiredFields changed`);
    }
    const entries = arrayOfObjects(inventory.entries, `inventories.${name}.entries`, errors);
    for (const entry of entries) {
        exactKeys(entry, requiredFields, `inventories.${name}.entry`, errors);
        validateKinds(entry, kindSchema(name), `inventories.${name}.entry`, errors);
    }
    uniqueIds(entries, idKey, `inventories.${name}`, errors);
    return entries;
}

function parseCanonicalJson(source: string, errors: string[]): unknown {
    if (!source.endsWith('\n') || source.includes('\r') || source.startsWith('\uFEFF')) {
        errors.push('manifest must use UTF-8, LF, and one terminal newline');
    }
    try {
        const parsed: unknown = JSON.parse(source);
        return parsed;
    } catch {
        errors.push('manifest is not valid JSON');
        return null;
    }
}

export function validateEvidenceManifest(source: string): string[] {
    const errors: string[] = [];
    const manifest = parseCanonicalJson(source, errors);
    if (!isObject(manifest)) {
        return [...errors, 'manifest root must be an object'];
    }
    exactKeys(manifest, FIELDS.manifest, 'manifest', errors);
    if (manifest.schemaVersion !== 1 || manifest.campaignId !== 'sourdaw-agent') {
        errors.push('manifest campaign identity changed');
    }

    if (!isObject(manifest.identity)) {
        errors.push('identity must be an object');
    } else {
        exactKeys(manifest.identity, FIELDS.identity, 'identity', errors);
        if (
            manifest.identity.baselineCommit !== 'b5c1dfeede35b52325b69c584db6a629349ae668' ||
            manifest.identity.dirty !== false
        ) {
            errors.push('integrated state must use the frozen baseline and be clean');
        }
        if (
            typeof manifest.identity.integratedCommit !== 'string' ||
            !/^[a-f0-9]{40}$/.test(manifest.identity.integratedCommit)
        ) {
            errors.push('identity.integratedCommit must be a commit SHA');
        }
        if (typeof manifest.identity.lockfileSha256 !== 'string' || !SHA256.test(manifest.identity.lockfileSha256)) {
            errors.push('identity.lockfileSha256 must be SHA-256');
        }
        if (!sameJson(manifest.identity.governingHashes, GOVERNING_HASHES)) {
            errors.push('governing hashes do not match the frozen campaign');
        }
        if (!isObject(manifest.identity.buildProvenance)) {
            errors.push('identity.buildProvenance must be an object');
        } else {
            exactKeys(
                manifest.identity.buildProvenance,
                ['kind', 'prerequisiteCommit', 'capturedAt'],
                'identity.buildProvenance',
                errors
            );
            if (manifest.identity.buildProvenance.prerequisiteCommit !== manifest.identity.integratedCommit) {
                errors.push('build provenance must match the integrated commit');
            }
        }
    }

    if (!isObject(manifest.environment)) {
        errors.push('environment must be an object');
    } else {
        exactKeys(manifest.environment, FIELDS.environment, 'environment', errors);
        if (!isObject(manifest.environment.audio)) {
            errors.push('environment.audio must be an object');
        } else {
            exactKeys(
                manifest.environment.audio,
                ['device', 'sampleRate', 'bufferFrames'],
                'environment.audio',
                errors
            );
            if (
                typeof manifest.environment.audio.sampleRate !== 'number' ||
                typeof manifest.environment.audio.bufferFrames !== 'number'
            ) {
                errors.push('environment audio rate and buffer must be measured');
            }
        }
    }

    const capabilities = arrayOfObjects(manifest.capabilities, 'capabilities', errors);
    const capabilityIds = uniqueIds(capabilities, 'id', 'capabilities', errors);
    for (const capability of capabilities) {
        exactKeys(capability, FIELDS.capability, 'capability', errors);
        validateKinds(capability, kindSchema('capabilities'), 'capability', errors);
        if (!['mandatory', 'admitted', 'unadmitted', 'unsupported'].includes(String(capability.status))) {
            errors.push(`invalid capability status for ${String(capability.id)}`);
        }
        if (capability.id === 'webllm' && capability.status !== 'mandatory') {
            errors.push('WebLLM must remain mandatory');
        }
        if (typeof capability.id === 'string' && UNADMITTED.has(capability.id) && capability.status !== 'unadmitted') {
            errors.push(`${capability.id} cannot be promoted by this campaign version`);
        }
    }
    for (const id of ['webllm', ...UNADMITTED]) {
        if (!capabilityIds.has(id)) {
            errors.push(`missing frozen capability ${id}`);
        }
    }

    if (!isObject(manifest.inventories)) {
        errors.push('inventories must be an object');
        return errors;
    }
    exactKeys(manifest.inventories, ['fixtures', 'gates', 'results'], 'inventories', errors);
    const fixtures = validateInventory(manifest.inventories.fixtures, 'fixtures', FIELDS.fixture, 'fixtureId', errors);
    const gates = validateInventory(manifest.inventories.gates, 'gates', FIELDS.gate, 'gateId', errors);
    const results = validateInventory(manifest.inventories.results, 'results', FIELDS.result, 'resultId', errors);

    const fixtureIds = uniqueIds(fixtures, 'fixtureId', 'fixtures', errors);
    for (const fixture of fixtures) {
        if (typeof fixture.sha256 !== 'string' || !SHA256.test(fixture.sha256)) {
            errors.push(`fixture ${String(fixture.fixtureId)} has invalid digest`);
        }
    }
    const gateIds = uniqueIds(gates, 'gateId', 'gates', errors);
    const suites = arrayOfObjects(manifest.suites, 'suites', errors);
    const suiteIds = uniqueIds(suites, 'id', 'suites', errors);
    if (!sameJson([...suiteIds], SUITES)) {
        errors.push('named suite inventory changed');
    }
    for (const suite of suites) {
        exactKeys(suite, FIELDS.suite, 'suite', errors);
        validateKinds(suite, kindSchema('suites'), 'suite', errors);
        if (typeof suite.capabilityId === 'string' && !capabilityIds.has(suite.capabilityId)) {
            errors.push(`suite ${String(suite.id)} references undeclared capability`);
        }
    }

    if (!sameJson(manifest.thresholds, FROZEN_THRESHOLDS)) {
        errors.push('frozen thresholds are missing or changed');
    }
    for (const gate of gates) {
        for (const id of stringArray(gate.prerequisiteGateIds, `gate ${String(gate.gateId)} prerequisites`, errors)) {
            if (!gateIds.has(id)) {
                errors.push(`gate ${String(gate.gateId)} references undeclared prerequisite ${id}`);
            }
        }
        for (const id of stringArray(gate.thresholds, `gate ${String(gate.gateId)} thresholds`, errors)) {
            if (!THRESHOLD_IDS.includes(id)) {
                errors.push(`gate ${String(gate.gateId)} references undeclared threshold ${id}`);
            }
        }
    }
    for (const result of results) {
        const gateOrSuiteId = typeof result.gateOrSuiteId === 'string' ? result.gateOrSuiteId : '';
        if (!gateIds.has(gateOrSuiteId) && !suiteIds.has(gateOrSuiteId)) {
            errors.push(`result ${String(result.resultId)} references undeclared gate or suite`);
        }
        for (const id of stringArray(result.fixtureIds, `result ${String(result.resultId)} fixtures`, errors)) {
            if (!fixtureIds.has(id)) {
                errors.push(`result ${String(result.resultId)} references undeclared fixture ${id}`);
            }
        }
        if (
            result.status !== 'pending' &&
            (typeof result.stdoutSha256 !== 'string' || !SHA256.test(result.stdoutSha256))
        ) {
            errors.push(`result ${String(result.resultId)} has invalid stdout digest`);
        }
        if (
            result.status !== 'pending' &&
            (typeof result.stderrSha256 !== 'string' || !SHA256.test(result.stderrSha256))
        ) {
            errors.push(`result ${String(result.resultId)} has invalid stderr digest`);
        }
    }
    return errors;
}
