import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { parseDocument } from 'yaml';

import certificate from './e2eSelectionShadowCertificate.json' with { type: 'json' };
import {
    git,
    hashInventoryFile,
    listIntegrationInventory,
    listInventory,
    readHeadSourceBindings,
    readIntegrationSourceHashes,
    sortInventoryRows,
    treeEntry,
    verifyIntegrationCheckout,
    type InventoryRow,
} from './e2eSelectionShadowIntegration.ts';
import { parseChangedPaths, selectValidationPlan, SMOKE_SPEC } from './prValidationScope.ts';
import { isPlaywrightCollected } from './vitestCollectionPatterns.ts';

type ChangedRecord = {
    status: string;
    oldPath: string | null;
    newPath: string | null;
    oldMode: string | null;
    newMode: string | null;
};
type SourceRow = { path: string; disposition: string; reason: string; producerRoute: string[] };

export {
    hashInventoryFile,
    listIntegrationInventory,
    listInventory,
    readHeadSourceBindings,
    readIntegrationSourceHashes,
    verifyIntegrationCheckout,
};
type ShadowInput = {
    base: string;
    head: string;
    integrationSha: string;
    rawDiff: Buffer;
    certificateSha256: string;
    records: ChangedRecord[];
    inventory: InventoryRow[];
    integrationInventory: InventoryRow[];
    sourceHashes: Record<string, string>;
    integrationSourceHashes: Record<string, string>;
    sourceModes: Record<string, string>;
    healthRequiredPolicySha256: string;
    candidateBase: string | null;
    candidateHead: string | null;
    livePlan: unknown;
};

const CANDIDATE_PATH = certificate.candidatePath;
const WITNESS = 'DIRECT_TUNER_WITNESS';
const UNPROVEN = 'SOURCE_ONLY_UNPROVEN';
const CERTIFICATE_SHA256 = '906c986190c48180e234cbb0fb1adb15f3a08b2a2e4631c966e32006b843b9ba';
const INTEGRATION_READER_SHA256 = '5d774576933ff4b07af65d326d2acbca20ac3d8af4d29d73f226f85c491cbb6a';
const ALLOWED_ATTRIBUTES = new Set(['className', 'title', 'detail', 'label', 'aria-label', 'aria-live', 'aria-atomic']);
const SHA = /^[0-9a-f]{40}$/;

function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseChangedRecords(raw: string): Omit<ChangedRecord, 'oldMode' | 'newMode'>[] {
    parseChangedPaths(raw);
    const fields = raw.split('\0');
    fields.pop();
    const records: Omit<ChangedRecord, 'oldMode' | 'newMode'>[] = [];
    for (let index = 0; index < fields.length;) {
        const status = fields[index++];
        if (status === undefined) {
            throw new Error('Missing diff status');
        }
        const first = fields[index++];
        if (first === undefined) {
            throw new Error('Missing diff path');
        }
        if (/^[RC]/.test(status)) {
            const second = fields[index++];
            if (second === undefined) {
                throw new Error('Missing rename/copy destination');
            }
            records.push({ status, oldPath: first, newPath: second });
        } else {
            records.push({ status, oldPath: status === 'A' ? null : first, newPath: status === 'D' ? null : first });
        }
    }
    return records;
}

function parseTsx(value: string): ts.SourceFile {
    const diagnostics =
        ts.transpileModule(value, {
            fileName: CANDIDATE_PATH,
            reportDiagnostics: true,
            compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest },
        }).diagnostics ?? [];
    const error = diagnostics.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    if (error) {
        throw new Error(`TSX parse failed: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
    }
    return ts.createSourceFile(CANDIDATE_PATH, value, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function commentsWithRoutes(file: ts.SourceFile): string[] {
    const comments: string[] = [];
    const visit = (node: ts.Node, route: string): void => {
        const leadingTrivia = file.text.slice(node.pos, node.getStart(file));
        for (const comment of leadingTrivia.match(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g) ?? []) {
            comments.push(`${route}:leading:${comment}`);
        }
        for (const range of ts.getTrailingCommentRanges(file.text, node.end) ?? []) {
            comments.push(`${route}:trailing:${file.text.slice(range.pos, range.end)}`);
        }
        let childIndex = 0;
        ts.forEachChild(node, (child) => visit(child, `${route}.${childIndex++}`));
    };
    visit(file, 'root');
    return comments;
}

function printedAst(file: ts.SourceFile, allowed: { start: number; end: number }[]): string {
    const transformed = ts.transform(file, [
        (context) => {
            const visit = (node: ts.Node): ts.Node => {
                const admittedValue = allowed.some(
                    (range) => range.start === node.getStart(file) && range.end === node.getEnd()
                );
                if (admittedValue && ts.isJsxText(node)) {
                    return ts.factory.createJsxText('SHADOW_VALUE');
                }
                if (admittedValue && ts.isStringLiteral(node)) {
                    return ts.factory.createStringLiteral('SHADOW_VALUE');
                }
                return ts.visitEachChild(node, visit, context);
            };
            return (root) => ts.visitNode(root, visit, ts.isSourceFile);
        },
    ]);
    try {
        const output = transformed.transformed[0];
        if (!output || !ts.isSourceFile(output)) {
            throw new Error('TSX transform did not produce a source file');
        }
        return ts.createPrinter({ removeComments: true }).printFile(output);
    } finally {
        transformed.dispose();
    }
}

function astComparison(before: string, after: string): { admitted: boolean; routes: string[] } {
    const oldFile = parseTsx(before);
    const newFile = parseTsx(after);
    if (canonical(commentsWithRoutes(oldFile)) !== canonical(commentsWithRoutes(newFile))) {
        return { admitted: false, routes: ['rejected: changed comments'] };
    }
    const routes: string[] = [];
    const oldAllowed: { start: number; end: number }[] = [];
    const newAllowed: { start: number; end: number }[] = [];
    const allow = (oldNode: ts.Node, newNode: ts.Node, route: string): void => {
        oldAllowed.push({ start: oldNode.getStart(oldFile), end: oldNode.getEnd() });
        newAllowed.push({ start: newNode.getStart(newFile), end: newNode.getEnd() });
        if (oldNode.getText(oldFile) !== newNode.getText(newFile)) {
            routes.push(route);
        }
    };
    const walk = (oldNode: ts.Node, newNode: ts.Node, parent: ts.Node | null): boolean => {
        if (oldNode.kind !== newNode.kind) {
            routes.push(`rejected: ${ts.SyntaxKind[oldNode.kind]} -> ${ts.SyntaxKind[newNode.kind]}`);
            return false;
        }
        if (ts.isJsxText(oldNode) && ts.isJsxText(newNode)) {
            allow(oldNode, newNode, 'allowed-edit: JSXText');
            return true;
        }
        if (ts.isStringLiteral(oldNode) && ts.isStringLiteral(newNode) && parent && ts.isJsxAttribute(parent)) {
            const name = parent.name.getText(oldFile);
            if (ALLOWED_ATTRIBUTES.has(name)) {
                allow(oldNode, newNode, `allowed-edit: JSXAttribute[${name}]`);
                return true;
            }
        }
        const oldChildren: ts.Node[] = [];
        const newChildren: ts.Node[] = [];
        ts.forEachChild(oldNode, (child) => {
            oldChildren.push(child);
        });
        ts.forEachChild(newNode, (child) => {
            newChildren.push(child);
        });
        if (oldChildren.length !== newChildren.length) {
            routes.push(`rejected: ${ts.SyntaxKind[oldNode.kind]} child-count`);
            return false;
        }
        if (oldChildren.length === 0) {
            if (oldNode.getText(oldFile) !== newNode.getText(newFile)) {
                routes.push(`rejected: ${ts.SyntaxKind[oldNode.kind]}`);
                return false;
            }
            return true;
        }
        return oldChildren.every((child, index) => {
            const replacement = newChildren[index];
            return replacement !== undefined && walk(child, replacement, oldNode);
        });
    };
    let admitted = walk(oldFile, newFile, null);
    if (admitted && printedAst(oldFile, oldAllowed) !== printedAst(newFile, newAllowed)) {
        routes.push('rejected: printed-ast');
        admitted = false;
    }
    return { admitted, routes: routes.length > 0 ? routes : ['allowed-edit: trivia'] };
}

function validateMeasurementInput(input: ShadowInput): {
    headInventory: InventoryRow[];
    inventory: InventoryRow[];
    full: string[];
    live: string[];
    inventoryDrift: boolean;
} {
    if (!SHA.test(input.base) || !SHA.test(input.head) || !SHA.test(input.integrationSha)) {
        throw new Error('Shadow requires immutable base/head/integration SHAs');
    }
    const parsed = parseChangedRecords(input.rawDiff.toString('utf8'));
    if (
        canonical(parsed) !==
        canonical(input.records.map(({ status, oldPath, newPath }) => ({ status, oldPath, newPath })))
    ) {
        throw new Error('Changed records disagree with raw diff');
    }
    const paths = parseChangedPaths(input.rawDiff.toString('utf8'));
    const headInventory = sortInventoryRows([...input.inventory]);
    const inventory = sortInventoryRows([...input.integrationInventory]);
    for (const rows of [headInventory, inventory]) {
        if (
            new Set(rows.map((row) => row.path)).size !== rows.length ||
            rows.some((row) => !isPlaywrightCollected(row.path))
        ) {
            throw new Error('Invalid Playwright inventory');
        }
    }
    for (const path of ['scripts/prValidationScope.ts', 'scripts/vitestCollectionPatterns.ts']) {
        if (input.integrationSourceHashes[path] !== input.sourceHashes[path] || !input.sourceHashes[path]) {
            throw new Error(`Integration selector or collector differs from candidate head: ${path}`);
        }
    }
    for (const path of [
        'playwright.config.ts',
        '.github/workflows/health-gates.yml',
        '.github/workflows/heavy-gates.yml',
        '.github/workflows/validation.yml',
        'package.json',
        'pnpm-lock.yaml',
    ]) {
        if (input.integrationSourceHashes[path] !== input.sourceHashes[path] || !input.sourceHashes[path]) {
            throw new Error(`Integration execution policy differs from candidate head: ${path}`);
        }
    }
    const expectedPlan = selectValidationPlan(
        paths,
        inventory.map((row) => row.path)
    );
    if (canonical(expectedPlan) !== canonical(input.livePlan)) {
        throw new Error('Authoritative scope artifact disagrees with the current selector or inventory');
    }
    const full = inventory.filter((row) => row.path !== SMOKE_SPEC).map((row) => row.path);
    if (full.length === 0) {
        throw new Error('Full browser inventory is empty');
    }
    return {
        headInventory,
        inventory,
        full,
        live: expectedPlan.matrix.include.flatMap((group) => group.specs).sort(),
        inventoryDrift: canonical(headInventory) !== canonical(inventory),
    };
}

export function sourceQualificationReasons(
    rows: readonly SourceRow[],
    boundSources: Readonly<Record<string, string>>
): string[] {
    const reasons: string[] = [];
    for (const row of rows) {
        if (row.disposition === UNPROVEN) {
            reasons.push(`source-map-unproved-obligation: ${row.path}`);
        }
    }
    const witnessRows = rows.filter((row) => row.disposition === WITNESS);
    for (const row of witnessRows) {
        for (const route of row.producerRoute) {
            const path = /^([^:,]+):[1-9]\d*(?:-[1-9]\d*)?(?:,[1-9]\d*(?:-[1-9]\d*)?)*$/.exec(route)?.[1];
            if (!path) {
                reasons.push(`source-map-producer-route-invalid: ${row.path}`);
            } else if (path !== CANDIDATE_PATH && !Object.hasOwn(boundSources, path)) {
                reasons.push(`source-map-producer-unbound: ${path}`);
            }
        }
    }
    return [...new Set(reasons)];
}

function certificateReasons(input: ShadowInput, inventory: InventoryRow[], full: string[]): string[] {
    const reasons: string[] = [];
    const certifiedRows = certificate.rows;
    const expectedRows = certifiedRows.map((row) => row.path).sort();
    if (canonical(full) !== canonical(expectedRows)) {
        reasons.push('inventory-certificate-drift: paths');
    } else {
        for (const row of inventory.filter((item) => item.path !== SMOKE_SPEC)) {
            const expected = certifiedRows.find((item) => item.path === row.path);
            if (
                !expected ||
                row.mode !== '100644' ||
                row.sha256 !== expected.sha256 ||
                row.gitBlob !== expected.gitBlob
            ) {
                reasons.push(`inventory-certificate-drift: ${row.path}`);
            }
        }
    }
    const witnessRows = certifiedRows.filter((row) => row.disposition === WITNESS);
    if (
        certifiedRows.length !== 313 ||
        witnessRows.length !== 2 ||
        certifiedRows.some(
            (row) =>
                (row.disposition !== WITNESS &&
                    row.disposition !== 'BOUNDED_SOURCE_EXCLUSION' &&
                    row.disposition !== UNPROVEN) ||
                !row.reason ||
                row.producerRoute.length === 0
        )
    ) {
        reasons.push('source-map-certificate-invalid');
    }
    reasons.push(...sourceQualificationReasons(certifiedRows, certificate.sourceHashes));
    for (const [path, expected] of Object.entries(certificate.sourceHashes)) {
        if (input.sourceHashes[path] !== expected || input.sourceModes[path] !== '100644') {
            reasons.push(`route-certificate-drift: ${path}`);
        }
    }
    if (input.healthRequiredPolicySha256 !== certificate.healthRequiredPolicySha256) {
        reasons.push('workflow-certificate-drift: health required policy');
    }
    if (input.certificateSha256 !== CERTIFICATE_SHA256) {
        reasons.push('source-map-certificate-drift');
    }
    if (
        input.sourceHashes['scripts/e2eSelectionShadowIntegration.ts'] !== INTEGRATION_READER_SHA256 ||
        input.sourceModes['scripts/e2eSelectionShadowIntegration.ts'] !== '100644'
    ) {
        reasons.push('integration-reader-drift');
    }
    return reasons;
}

function candidateAstReady(
    input: ShadowInput,
    onlyCandidate: boolean
): input is ShadowInput & { candidateBase: string; candidateHead: string } {
    return (
        onlyCandidate &&
        input.records[0]?.oldMode === '100644' &&
        input.records[0]?.newMode === '100644' &&
        input.candidateBase !== null &&
        input.candidateHead !== null &&
        sha256(input.candidateBase) === certificate.candidatePreimageSha256
    );
}

function candidateDecision(input: ShadowInput, reasons: string[]): string[] {
    const astRoutes: string[] = [];
    const onlyCandidate =
        input.records.length === 1 &&
        input.records[0]?.status === 'M' &&
        input.records[0].oldPath === CANDIDATE_PATH &&
        input.records[0].newPath === CANDIDATE_PATH;
    if (!onlyCandidate) {
        reasons.push('changed-path-or-status-not-qualified');
    } else if (input.records[0]?.oldMode !== '100644' || input.records[0]?.newMode !== '100644') {
        reasons.push('candidate-mode-not-regular');
    }
    if (
        onlyCandidate &&
        input.candidateBase !== null &&
        sha256(input.candidateBase) !== certificate.candidatePreimageSha256
    ) {
        reasons.push('candidate-preimage-drift');
    }
    if (onlyCandidate && (input.candidateBase === null || input.candidateHead === null)) {
        reasons.push('candidate-source-missing');
    }
    if (candidateAstReady(input, onlyCandidate)) {
        const comparison = astComparison(input.candidateBase, input.candidateHead);
        astRoutes.push(...comparison.routes);
        if (!comparison.admitted) {
            reasons.push('candidate-ast-not-presentation-only');
        }
    }
    return astRoutes;
}

export function measureShadow(input: ShadowInput) {
    const { headInventory, inventory, full, live, inventoryDrift } = validateMeasurementInput(input);
    const fallbackReasons = certificateReasons(input, inventory, full);
    if (inventoryDrift) {
        fallbackReasons.push('scope-head-inventory-drift');
    }
    for (const [path, headSha] of Object.entries(input.sourceHashes)) {
        if (input.integrationSourceHashes[path] !== headSha) {
            fallbackReasons.push(`integration-source-drift: ${path}`);
        }
    }
    const astRoutes = candidateDecision(input, fallbackReasons);
    const witnessRows = certificate.rows.filter((row) => row.disposition === WITNESS);
    const candidate = fallbackReasons.length === 0 ? witnessRows.map((row) => row.path).sort() : full;
    const certified = new Map(certificate.rows.map((row) => [row.path, row]));
    const obligationDispositions = inventory
        .filter((row) => row.path !== SMOKE_SPEC)
        .map(
            (row) =>
                certified.get(row.path) ?? {
                    path: row.path,
                    gitBlob: row.gitBlob,
                    sha256: row.sha256,
                    disposition: 'INTEGRATION_UNMAPPED',
                    reason: 'Integration spec is absent from the frozen source-map certificate',
                    producerRoute: [],
                }
        );
    return {
        schemaVersion: 1 as const,
        shadowOnly: true as const,
        measurementStatus: 'complete' as const,
        base: input.base,
        head: input.head,
        integrationSha: input.integrationSha,
        rawDiffSha256: sha256(input.rawDiff),
        certificateSha256: input.certificateSha256,
        sourceMapSha256: certificate.sourceMapSha256,
        inventorySha256: sha256(canonical(inventory)),
        headInventorySha256: sha256(canonical(headInventory)),
        sourceAndConfigurationSha256: input.sourceHashes,
        integrationSourceAndConfigurationSha256: input.integrationSourceHashes,
        sourceModes: input.sourceModes,
        healthRequiredPolicySha256: input.healthRequiredPolicySha256,
        changedRecords: input.records,
        astRoutes,
        candidateSpecs: candidate,
        liveSelectedSpecs: live,
        fallbackReasons,
        counts: { inventory: full.length, candidate: candidate.length, liveSelected: live.length },
        obligationDispositions,
    };
}

function healthPolicyDigest(workflowSource: string): string {
    const document = parseDocument(workflowSource);
    if (document.errors.length > 0) {
        throw new Error('Invalid health workflow YAML');
    }
    const workflow: unknown = document.toJS();
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
        throw new Error('Invalid health workflow');
    }
    const { jobs, ...top } = workflow;
    if (!isRecord(jobs)) {
        throw new Error('Invalid health workflow jobs');
    }
    const required = Object.fromEntries(
        ['scope', 'validation', 'affected', 'codeql', 'gate'].map((name) => [name, jobs[name]])
    );
    if (Object.values(required).some((job) => job === undefined)) {
        throw new Error('Missing required health job');
    }
    return sha256(canonical({ ...top, jobs: required }));
}

function main(): void {
    const {
        BASE_SHA: base,
        HEAD_SHA: head,
        INTEGRATION_SHA: integrationSha,
        INTEGRATION_ROOT: integrationPath,
    } = process.env;
    const scopePath = process.argv[2];
    if (
        !base ||
        !head ||
        !integrationSha ||
        !integrationPath ||
        !scopePath ||
        !SHA.test(base) ||
        !SHA.test(head) ||
        !SHA.test(integrationSha)
    ) {
        throw new Error('Shadow requires BASE_SHA, HEAD_SHA, INTEGRATION_SHA, INTEGRATION_ROOT and the scope manifest');
    }
    const root = process.cwd();
    const integrationRoot = resolve(root, integrationPath);
    if (integrationRoot === root) {
        throw new Error('Integration checkout must be distinct from candidate head');
    }
    if (git(['rev-parse', 'HEAD']).toString('utf8').trim() !== head) {
        throw new Error('Shadow checkout does not match the immutable head');
    }
    verifyIntegrationCheckout(integrationRoot, integrationSha, head, base);
    const rawDiff = git(['diff', '--name-status', '-z', '--find-renames', `${base}...${head}`, '--']);
    const parsed = parseChangedRecords(rawDiff.toString('utf8'));
    const mergeBase = git(['merge-base', base, head]).toString('utf8').trim();
    const records: ChangedRecord[] = parsed.map((record) => ({
        ...record,
        oldMode: record.oldPath ? (treeEntry(mergeBase, record.oldPath)?.mode ?? null) : null,
        newMode: record.newPath ? (treeEntry(head, record.newPath)?.mode ?? null) : null,
    }));
    const onlyCandidate = records.length === 1 && records[0]?.status === 'M' && records[0].oldPath === CANDIDATE_PATH;
    const sourcePaths = [
        ...Object.keys(certificate.sourceHashes),
        '.github/workflows/health-gates.yml',
        'scripts/e2eSelectionShadow.ts',
        'scripts/e2eSelectionShadowIntegration.ts',
    ];
    const { sourceModes, sourceHashes } = readHeadSourceBindings(root, head, sourcePaths, [
        'scripts/e2eSelectionShadow.ts',
        'scripts/e2eSelectionShadowIntegration.ts',
    ]);
    const integrationSourceHashes = readIntegrationSourceHashes(integrationRoot, integrationSha, sourcePaths);
    const certificateSha256 = sha256(git(['show', `${head}:scripts/e2eSelectionShadowCertificate.json`]));
    if (sha256(readFileSync(resolve(root, 'scripts/e2eSelectionShadowCertificate.json'))) !== certificateSha256) {
        throw new Error('Shadow certificate in checkout disagrees with the immutable head');
    }
    const candidateBase = onlyCandidate ? git(['show', `${mergeBase}:${CANDIDATE_PATH}`]).toString('utf8') : null;
    const candidateHead = onlyCandidate ? git(['show', `${head}:${CANDIDATE_PATH}`]).toString('utf8') : null;
    let healthRequiredPolicySha256 = 'missing-or-nonregular';
    if (sourceModes['.github/workflows/health-gates.yml'] === '100644') {
        healthRequiredPolicySha256 = healthPolicyDigest(
            git(['show', `${head}:.github/workflows/health-gates.yml`]).toString('utf8')
        );
    }
    const plan: unknown = JSON.parse(readFileSync(scopePath, 'utf8'));
    const report = measureShadow({
        base,
        head,
        integrationSha,
        rawDiff,
        certificateSha256,
        records,
        inventory: listInventory(root, head),
        integrationInventory: listIntegrationInventory(integrationRoot, integrationSha),
        sourceHashes,
        integrationSourceHashes,
        sourceModes,
        healthRequiredPolicySha256,
        candidateBase,
        candidateHead,
        livePlan: plan,
    });
    writeFileSync('e2e-selection-shadow.json', `${JSON.stringify(report, null, 2)}\n`);
    console.log(
        JSON.stringify({
            measurementStatus: report.measurementStatus,
            counts: report.counts,
            fallbackReasons: report.fallbackReasons,
        })
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        writeFileSync(
            'e2e-selection-shadow.json',
            `${JSON.stringify(
                {
                    schemaVersion: 1,
                    shadowOnly: true,
                    measurementStatus: 'failed',
                    base: process.env.BASE_SHA ?? null,
                    head: process.env.HEAD_SHA ?? null,
                    failureReason: reason,
                },
                null,
                2
            )}\n`
        );
        console.error(`E2E shadow measurement failed: ${reason}`);
        process.exitCode = 1;
    }
}
