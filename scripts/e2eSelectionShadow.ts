import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { parseDocument } from 'yaml';

import certificate from './e2eSelectionShadowCertificate.json' with { type: 'json' };
import { parseChangedPaths, selectValidationPlan, SMOKE_SPEC } from './prValidationScope.ts';
import { isPlaywrightCollected } from './vitestCollectionPatterns.ts';

type ChangedRecord = {
    status: string;
    oldPath: string | null;
    newPath: string | null;
    oldMode: string | null;
    newMode: string | null;
};
type InventoryRow = { path: string; gitBlob: string; sha256: string; mode: string };
type SourceRow = { path: string; disposition: string; reason: string; producerRoute: string[] };
type ShadowInput = {
    base: string;
    head: string;
    rawDiff: Buffer;
    certificateSha256: string;
    records: ChangedRecord[];
    inventory: InventoryRow[];
    sourceHashes: Record<string, string>;
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

function validateMeasurementInput(input: ShadowInput): { inventory: InventoryRow[]; full: string[]; live: string[] } {
    if (!SHA.test(input.base) || !SHA.test(input.head)) {
        throw new Error('Shadow requires immutable base/head SHAs');
    }
    const parsed = parseChangedRecords(input.rawDiff.toString('utf8'));
    if (
        canonical(parsed) !==
        canonical(input.records.map(({ status, oldPath, newPath }) => ({ status, oldPath, newPath })))
    ) {
        throw new Error('Changed records disagree with raw diff');
    }
    const paths = parseChangedPaths(input.rawDiff.toString('utf8'));
    const inventory = [...input.inventory].sort((a, b) => {
        if (a.path < b.path) {
            return -1;
        }
        if (a.path > b.path) {
            return 1;
        }
        return 0;
    });
    if (
        new Set(inventory.map((row) => row.path)).size !== inventory.length ||
        inventory.some((row) => !isPlaywrightCollected(row.path))
    ) {
        throw new Error('Invalid Playwright inventory');
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
    return { inventory, full, live: expectedPlan.matrix.include.flatMap((group) => group.specs).sort() };
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
            const path = /^([^:]+):\d+(?:-\d+)?$/.exec(route)?.[1];
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
    const { inventory, full, live } = validateMeasurementInput(input);
    const fallbackReasons = certificateReasons(input, inventory, full);
    const astRoutes = candidateDecision(input, fallbackReasons);
    const witnessRows = certificate.rows.filter((row) => row.disposition === WITNESS);
    const candidate = fallbackReasons.length === 0 ? witnessRows.map((row) => row.path).sort() : full;
    return {
        schemaVersion: 1 as const,
        shadowOnly: true as const,
        measurementStatus: 'complete' as const,
        base: input.base,
        head: input.head,
        rawDiffSha256: sha256(input.rawDiff),
        certificateSha256: input.certificateSha256,
        sourceMapSha256: certificate.sourceMapSha256,
        inventorySha256: sha256(canonical(inventory)),
        sourceAndConfigurationSha256: input.sourceHashes,
        sourceModes: input.sourceModes,
        healthRequiredPolicySha256: input.healthRequiredPolicySha256,
        changedRecords: input.records,
        astRoutes,
        candidateSpecs: candidate,
        liveSelectedSpecs: live,
        fallbackReasons,
        counts: { inventory: full.length, candidate: candidate.length, liveSelected: live.length },
        obligationDispositions: certificate.rows,
    };
}

function git(args: string[]): Buffer {
    return execFileSync('git', args, { maxBuffer: 16 * 1024 * 1024 });
}

function treeEntry(ref: string, path: string): { mode: string; blob: string } | null {
    const raw = git(['ls-tree', '-z', ref, '--', `:(literal)${path}`]).toString('utf8');
    if (raw === '') {
        return null;
    }
    const match = /^(\d+) blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(raw);
    if (!match || match[3] !== path) {
        throw new Error(`Invalid tree entry: ${path}`);
    }
    return { mode: match[1] ?? '', blob: match[2] ?? '' };
}

function listInventory(root: string, head: string): InventoryRow[] {
    const rows: InventoryRow[] = [];
    for (const entry of readdirSync(resolve(root, 'tests/e2e'), { recursive: true, withFileTypes: true })) {
        const path = relative(root, resolve(entry.parentPath, entry.name));
        if (!isPlaywrightCollected(path)) {
            continue;
        }
        const tree = treeEntry(head, path);
        const mode = tree?.mode ?? 'missing';
        const file = resolve(root, path);
        const sha = entry.isFile() && lstatSync(file).isFile() ? sha256(readFileSync(file)) : 'missing';
        rows.push({ path, gitBlob: tree?.blob ?? 'missing', sha256: sha, mode });
    }
    return rows;
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
    const { BASE_SHA: base, HEAD_SHA: head } = process.env;
    const scopePath = process.argv[2];
    if (!base || !head || !scopePath || !SHA.test(base) || !SHA.test(head)) {
        throw new Error('Shadow requires BASE_SHA, HEAD_SHA and the downloaded scope manifest path');
    }
    const root = process.cwd();
    if (git(['rev-parse', 'HEAD']).toString('utf8').trim() !== head) {
        throw new Error('Shadow checkout does not match the immutable head');
    }
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
    ];
    const sourceModes = Object.fromEntries(sourcePaths.map((path) => [path, treeEntry(head, path)?.mode ?? 'missing']));
    const sourceHashes = Object.fromEntries(
        sourcePaths.map((path) => [
            path,
            sourceModes[path] === '100644' ? sha256(git(['show', `${head}:${path}`])) : 'missing-or-nonregular',
        ])
    );
    if (
        sha256(readFileSync(resolve(root, 'scripts/e2eSelectionShadow.ts'))) !==
        sourceHashes['scripts/e2eSelectionShadow.ts']
    ) {
        throw new Error('Shadow rule in checkout disagrees with the immutable head');
    }
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
        rawDiff,
        certificateSha256,
        records,
        inventory: listInventory(root, head),
        sourceHashes,
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
