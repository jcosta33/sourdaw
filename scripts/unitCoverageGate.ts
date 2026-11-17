import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import istanbul from '@vitest/coverage-istanbul';
import ts from 'typescript';
import { createVitest } from 'vitest/node';

import { readCheckoutDiff } from './prValidationScopeCheckout.ts';
import { isProductionCoveragePath, unitCoverageJson, unitCoverageShardCount } from './unitCoveragePaths.ts';

const floorPath = 'scripts/unitCoverageFloors.json';
const metrics = ['lines', 'statements', 'branches', 'functions'] as const;
const floorScale = 10_000;
const changedLineMinimum = 90;
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

type Metric = (typeof metrics)[number];
type Floors = { version: 1 } & Record<Metric, number>;
type Totals = { covered: number; total: number };
type LineRange = { start: number; count: number };
type ChangedLines = Map<string, LineRange[]>;
type UncoveredLine = { path: string; line: number };
type CoverageIdentity = { revision: string; runId: string; attempt: string };
type ShardCoverage = { coverage: Record<string, unknown>; elapsedMs: number };

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Invalid ${label}`);
    }
    return value as Record<string, unknown>;
}

function integer(value: unknown, label: string, minimum = 0): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`Invalid ${label}`);
    }
    return value;
}

function json(path: string): unknown {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function git(root: string, args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function assertOid(value: string): void {
    if (!oidPattern.test(value)) {
        throw new Error('Invalid coverage Git revision');
    }
}

function allSourceLines(root: string, blob: string): LineRange[] {
    const source = git(root, ['cat-file', 'blob', blob]);
    const count = source.split('\n').length - (source.endsWith('\n') || source.length === 0 ? 1 : 0);
    return [{ start: 1, count }];
}

function editedSourceLines(root: string, oldBlob: string, newBlob: string): LineRange[] {
    if (oldBlob === newBlob) {
        return [];
    }
    assertOid(oldBlob);
    const patch = git(root, [
        'diff',
        '--no-color',
        '--unified=0',
        '--no-ext-diff',
        '--no-textconv',
        '--diff-algorithm=myers',
        '--no-indent-heuristic',
        '--text',
        oldBlob,
        newBlob,
        '--',
    ]);
    const ranges: LineRange[] = [];
    for (const match of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
        const count = Number(match[2] ?? 1);
        if (count > 0) {
            ranges.push({ start: Number(match[1]), count });
        }
    }
    if (!patch.includes('\n@@ ')) {
        throw new Error(`Missing Git hunks between production blobs ${oldBlob} and ${newBlob}`);
    }
    return ranges;
}

export function changedProductionLines(root: string, base: string, tested: string): ChangedLines {
    assertOid(base);
    assertOid(tested);
    const fields = git(root, [
        'diff',
        '--raw',
        '-z',
        '--no-abbrev',
        '--find-renames',
        '--diff-filter=ACMRT',
        base,
        tested,
        '--',
    ]).split('\0');
    const changed: ChangedLines = new Map();
    for (let index = 0; index < fields.length - 1;) {
        const metadata = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]+) ([a-f0-9]+) ([ACMRT])[0-9]*$/.exec(fields[index++] ?? '');
        if (metadata === null) {
            throw new Error('Invalid Git raw diff for unit coverage');
        }
        const [, oldMode, newMode, oldBlob = '', newBlob = '', status] = metadata;
        const previousPath = fields[index++] ?? '';
        const path = status === 'R' || status === 'C' ? (fields[index++] ?? '') : previousPath;
        if (path === '' || previousPath === '') {
            throw new Error('Missing path in Git raw diff for unit coverage');
        }
        if (!isProductionCoveragePath(path)) {
            continue;
        }
        assertOid(newBlob);
        if (!/^100(?:644|755)$/.test(newMode ?? '')) {
            throw new Error(`Unsupported production file in unit coverage: ${JSON.stringify(path)}`);
        }
        const newlyInScope =
            status === 'A' || !isProductionCoveragePath(previousPath) || !/^100(?:644|755)$/.test(oldMode ?? '');
        const ranges = newlyInScope ? allSourceLines(root, newBlob) : editedSourceLines(root, oldBlob, newBlob);
        changed.set(path, ranges);
    }
    return changed;
}

export function readCoverageFloors(source: string): Floors {
    const record = asRecord(JSON.parse(source) as unknown, 'coverage floors');
    const expectedFields = ['version', ...metrics];
    if (record.version !== 1 || Object.keys(record).length !== expectedFields.length) {
        throw new Error('Invalid coverage floors version or fields');
    }
    const get = (key: Metric): number => {
        const floor = integer(record[key], `coverage floors: ${key}`);
        if (floor > floorScale) {
            throw new Error(`Invalid coverage floors: ${key}`);
        }
        return floor;
    };
    return {
        version: 1,
        lines: get('lines'),
        statements: get('statements'),
        branches: get('branches'),
        functions: get('functions'),
    };
}

function floorsAt(root: string, revision: string): Floors | undefined {
    if (git(root, ['ls-tree', '--full-tree', revision, '--', floorPath]) === '') {
        return undefined;
    }
    return readCoverageFloors(git(root, ['show', `${revision}:${floorPath}`]));
}

function readHits(record: Record<string, unknown>, field: string): Record<string, unknown> {
    return asRecord(record[field], `coverage counters ${field}`);
}

function positiveCount(value: unknown): number {
    return integer(value, 'coverage hit count') > 0 ? 1 : 0;
}

function spanStart(value: unknown, restoreEndColumn: boolean): number {
    const span = asRecord(value, 'coverage span');
    const start = asRecord(span.start, 'coverage span start');
    const end = asRecord(span.end, 'coverage span end');
    const line = integer(start.line, 'coverage start line', 1);
    integer(start.column, 'coverage start column');
    integer(end.line, 'coverage end line', line);
    // Istanbul's source-map remapper uses Infinity for an end column beyond the mapped span.
    // JSON serializes that sentinel as null.
    if (end.column === null) {
        if (restoreEndColumn) {
            end.column = Number.POSITIVE_INFINITY;
        }
    } else {
        integer(end.column, 'coverage end column');
    }
    return line;
}

function addCounter(totals: Totals, value: unknown): void {
    totals.total++;
    totals.covered += positiveCount(value);
}

function forMappedCounters(
    file: Record<string, unknown>,
    mapField: string,
    hitField: string,
    visit: (location: unknown, hit: unknown) => void
): void {
    const locations = asRecord(file[mapField], `coverage locations ${mapField}`);
    const hits = readHits(file, hitField);
    if (Object.keys(locations).length !== Object.keys(hits).length) {
        throw new Error(`Mismatched coverage locations and counters: ${mapField}`);
    }
    for (const [id, location] of Object.entries(locations)) {
        if (!/^\d+$/.test(id) || !Object.hasOwn(hits, id)) {
            throw new Error(`Invalid coverage counter ID: ${mapField}`);
        }
        visit(location, hits[id]);
    }
}

function fileTotals(
    file: Record<string, unknown>,
    overall: Record<Metric, Totals>,
    restoreEndColumn = false
): Map<number, number> {
    const lines = new Map<number, number>();
    forMappedCounters(file, 'statementMap', 's', (location, hit) => {
        addCounter(overall.statements, hit);
        // Istanbul defines a line using the maximum hit count of statements starting there.
        const line = spanStart(location, restoreEndColumn);
        lines.set(line, Math.max(lines.get(line) ?? 0, positiveCount(hit)));
    });
    forMappedCounters(file, 'fnMap', 'f', (location, hit) => {
        const fn = asRecord(location, 'coverage function mapping');
        spanStart(fn.decl, restoreEndColumn);
        spanStart(fn.loc, restoreEndColumn);
        if (typeof fn.name !== 'string') {
            throw new TypeError('Invalid coverage function name');
        }
        addCounter(overall.functions, hit);
    });
    forMappedCounters(file, 'branchMap', 'b', (location, hits) => {
        const branch = asRecord(location, 'coverage branch mapping');
        spanStart(branch.loc, restoreEndColumn);
        if (
            typeof branch.type !== 'string' ||
            !Array.isArray(branch.locations) ||
            !Array.isArray(hits) ||
            branch.locations.length !== hits.length
        ) {
            throw new Error('Invalid coverage branch counters');
        }
        const locations: readonly unknown[] = branch.locations;
        const counters: readonly unknown[] = hits;
        for (const [index, location] of locations.entries()) {
            const arm = asRecord(location, 'coverage branch arm');
            // Istanbul emits empty positions for an implicit else arm.
            if (
                branch.type === 'if' &&
                index === 1 &&
                Object.keys(asRecord(arm.start, 'coverage branch start')).length === 0 &&
                Object.keys(asRecord(arm.end, 'coverage branch end')).length === 0
            ) {
                continue;
            }
            spanStart(arm, restoreEndColumn);
        }
        for (const hit of counters) {
            addCounter(overall.branches, hit);
        }
    });
    for (const hit of lines.values()) {
        addCounter(overall.lines, hit);
    }
    return lines;
}

function emptyTotals(): Record<Metric, Totals> {
    return {
        lines: { covered: 0, total: 0 },
        statements: { covered: 0, total: 0 },
        branches: { covered: 0, total: 0 },
        functions: { covered: 0, total: 0 },
    };
}

export function evaluateUnitCoverage(
    report: unknown,
    changedLines: ChangedLines,
    previous: Floors | undefined,
    proposed: Floors | undefined
): {
    overall: Record<Metric, Totals>;
    measured: Floors;
    changed: Totals & { uncovered: UncoveredLine[] };
    failures: string[];
} {
    const overall = emptyTotals();
    const changed = { covered: 0, total: 0, uncovered: [] as UncoveredLine[] };
    const failures: string[] = [];
    const files = asRecord(report, 'merged coverage report');
    for (const [path, entry] of Object.entries(files)) {
        const file = asRecord(entry, 'file coverage');
        if (!isProductionCoveragePath(path) || file.path !== path) {
            throw new Error(`Invalid merged coverage file: ${JSON.stringify(path)}`);
        }
        const lines = fileTotals(file, overall);
        const ranges = changedLines.get(path) ?? [];
        for (const [line, hits] of lines) {
            if (ranges.some(({ start, count }) => line >= start && line < start + count)) {
                addCounter(changed, hits);
                if (hits === 0) {
                    changed.uncovered.push({ path, line });
                }
            }
        }
    }
    for (const path of changedLines.keys()) {
        if (!Object.hasOwn(files, path)) {
            failures.push(`Coverage is missing for changed file ${JSON.stringify(path)}`);
        }
    }
    if (changed.covered * 100 < changed.total * changedLineMinimum) {
        failures.push(
            `Changed executable line coverage ${changed.covered}/${changed.total} is below ${changedLineMinimum}%`
        );
    }
    const measured: Floors = { version: 1, lines: 0, statements: 0, branches: 0, functions: 0 };
    for (const metric of metrics) {
        const { covered, total } = overall[metric];
        if (total === 0) {
            throw new Error(`Empty overall production coverage for ${metric}`);
        }
        measured[metric] = Math.floor((covered * floorScale) / total);
        if (proposed === undefined) {
            continue;
        }
        const baseFloor = previous?.[metric];
        if (baseFloor !== undefined && proposed[metric] < baseFloor) {
            failures.push(
                `${metric} floor decreased from ${formatFloor(baseFloor)} to ${formatFloor(proposed[metric])}`
            );
        }
        if (covered * floorScale < proposed[metric] * total) {
            failures.push(`${metric} coverage ${covered}/${total} is below its ${formatFloor(proposed[metric])} floor`);
        }
    }
    if (proposed === undefined) {
        failures.push(`Coverage floors missing: commit ${floorPath} from measured-floors.json`);
    }
    return { overall, measured, changed, failures };
}

function formatFloor(value: number): string {
    return `${(value / 100).toFixed(2)}%`;
}

function productionPaths(root: string, revision: string): Set<string> {
    const tree = git(root, ['ls-tree', '-r', '-z', '--full-tree', revision, '--', 'src']);
    const paths = new Set<string>();
    for (const item of tree.split('\0').filter(Boolean)) {
        const separator = item.indexOf('\t');
        const path = item.slice(separator + 1);
        if (separator < 0) {
            throw new Error('Invalid Git source inventory for unit coverage');
        }
        if (isProductionCoveragePath(path)) {
            if (!/^100(?:644|755) blob /.test(item)) {
                throw new Error(`Unsupported production file in unit coverage: ${JSON.stringify(path)}`);
            }
            paths.add(path);
        }
    }
    if (paths.size === 0) {
        throw new Error('Empty Git production inventory for unit coverage');
    }
    return paths;
}

function normalizedCoverage(
    value: unknown,
    source: string,
    checkout: string,
    production: ReadonlySet<string>
): Record<string, unknown> {
    const coverage = asRecord(value, 'shard coverage');
    const normalized: Record<string, unknown> = {};
    const totals = emptyTotals();
    for (const [path, data] of Object.entries(coverage)) {
        const file = asRecord(data, 'shard file coverage');
        const relativePath = path.slice(source.length + 1);
        if (!path.startsWith(`${source}/`) || !production.has(relativePath) || file.path !== path) {
            throw new Error(`Unexpected shard coverage path: ${JSON.stringify(path)}`);
        }
        try {
            fileTotals(file, totals, true);
        } catch (error) {
            throw new Error(`Malformed coverage for ${JSON.stringify(relativePath)}`, { cause: error });
        }
        const absolutePath = join(checkout, relativePath);
        normalized[absolutePath] = {
            path: absolutePath,
            statementMap: file.statementMap,
            fnMap: file.fnMap,
            branchMap: file.branchMap,
            s: file.s,
            f: file.f,
            b: file.b,
        };
    }
    if (totals.lines.total === 0) {
        throw new Error('Empty shard production coverage');
    }
    return normalized;
}

export async function mergeUnitCoverage(
    input: string,
    output: string,
    checkout: string,
    identity: CoverageIdentity,
    production: ReadonlySet<string>
): Promise<number[]> {
    const names = Array.from({ length: unitCoverageShardCount }, (_, index) => `shard-${index + 1}.json`);
    if (readdirSync(input).sort().join('\0') !== names.join('\0')) {
        throw new Error('Coverage requires exactly one report from each of the four unit shards');
    }
    const sourceRoots = new Set<string>();
    const shards: ShardCoverage[] = names.map((name, index) => {
        const packet = asRecord(json(join(input, name)), 'coverage shard packet');
        if (
            packet.version !== 1 ||
            packet.shard !== index + 1 ||
            packet.revision !== identity.revision ||
            packet.runId !== identity.runId ||
            packet.attempt !== identity.attempt ||
            typeof packet.sourceRoot !== 'string' ||
            !isAbsolute(packet.sourceRoot) ||
            packet.sourceRoot !== resolve(packet.sourceRoot) ||
            sourceRoots.has(packet.sourceRoot)
        ) {
            throw new Error(`Coverage identity mismatch in ${name}`);
        }
        sourceRoots.add(packet.sourceRoot);
        return {
            coverage: normalizedCoverage(packet.coverage, packet.sourceRoot, checkout, production),
            elapsedMs: integer(packet.elapsedMs, 'coverage shard duration', 1),
        };
    });
    const runner = await createVitest({
        config: false,
        root: checkout,
        watch: false,
        coverage: { enabled: true, provider: 'istanbul', reportsDirectory: output, reporter: ['json', 'html'] },
    });
    try {
        const provider = await istanbul.getProvider();
        if (provider.mergeReports === undefined) {
            throw new Error('Vitest coverage provider cannot merge shard reports');
        }
        await provider.initialize(runner);
        await provider.mergeReports(shards.map(({ coverage }) => coverage));
    } finally {
        await runner.close();
    }
    return shards.map(({ elapsedMs }) => elapsedMs);
}

function requiredEnv(key: string): string {
    const value = process.env[key];
    if (value === undefined || value === '') {
        throw new Error(`Unit coverage requires ${key}`);
    }
    return value;
}

function reportEvaluation(
    output: string,
    result: ReturnType<typeof evaluateUnitCoverage>,
    proposed: Floors | undefined,
    timings: number[],
    revision: { tested: string; base: string; head: string; runId: string; attempt: string }
): void {
    writeFileSync(join(output, 'measured-floors.json'), `${JSON.stringify(result.measured, null, 2)}\n`);
    writeFileSync(
        join(output, 'gate.json'),
        `${JSON.stringify({ revision, ...result, shardElapsedMs: timings }, null, 2)}\n`
    );
    const lines = [
        '### PR unit coverage',
        '',
        '| Metric | Covered / total | Measured | Proposed floor |',
        '| --- | ---: | ---: | ---: |',
        ...metrics.map((metric) => {
            const { covered, total } = result.overall[metric];
            const floor = proposed === undefined ? 'Uninitialized' : formatFloor(proposed[metric]);
            return `| ${metric} | ${covered} / ${total} | ${formatFloor(result.measured[metric])} | ${floor} |`;
        }),
        '',
        result.changed.total === 0
            ? 'No changed executable lines.'
            : `Changed executable lines covered: ${result.changed.covered} / ${result.changed.total} (minimum ${changedLineMinimum}%).`,
        `Isolated shard commands (including coverage generation): ${timings.map((value) => `${(value / 1000).toFixed(1)}s`).join(', ')}.`,
        '',
        ...result.failures.map((failure) => `- ${failure}`),
        '',
        'Download the PR unit coverage artifact for the HTML report and every uncovered changed file and line in gate.json.',
        '',
    ];
    appendFileSync(requiredEnv('GITHUB_STEP_SUMMARY'), `${lines.join('\n')}\n`);
    for (const { path, line } of result.changed.uncovered) {
        console.log(`Uncovered changed line: ${JSON.stringify(path)}:${line}`);
    }
    for (const failure of result.failures) {
        console.error(failure);
    }
}

function hasNoInstrumentableBody(root: string, revision: string, path: string): boolean {
    // Istanbul omits empty remapped files. Prove each omitted tracked blob has
    // no runtime statements beyond static imports and exports.
    const source = git(root, ['show', `${revision}:${path}`]);
    const emitted = ts.transpileModule(source, {
        fileName: path,
        reportDiagnostics: true,
        compilerOptions: {
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.Preserve,
            verbatimModuleSyntax: true,
        },
    });
    if (emitted.diagnostics?.some(({ category }) => category === ts.DiagnosticCategory.Error)) {
        return false;
    }
    const parsed = ts.createSourceFile(path, emitted.outputText, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JSX);
    return parsed.statements.every(
        (statement) => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
    );
}

async function main(): Promise<number> {
    const root = process.cwd();
    const revision = requiredEnv('GITHUB_SHA');
    const base = requiredEnv('BASE_SHA');
    const head = requiredEnv('HEAD_SHA');
    const identity = { revision, runId: requiredEnv('GITHUB_RUN_ID'), attempt: requiredEnv('GITHUB_RUN_ATTEMPT') };
    for (const sha of [revision, base, head]) {
        assertOid(sha);
    }
    const { checkout, firstParent } = readCheckoutDiff(root, base, head);
    if (checkout !== revision || checkout === head) {
        throw new Error('Coverage checkout must be the tested PR merge of the immutable base and head');
    }
    const input = resolve(requiredEnv('COVERAGE_SHARDS'));
    const output = resolve(requiredEnv('COVERAGE_REPORT'));
    mkdirSync(output, { recursive: true });
    const production = productionPaths(root, revision);
    const timings = await mergeUnitCoverage(input, output, root, identity, production);
    const paths = asRecord(json(join(output, unitCoverageJson)), 'merged coverage report');
    const coverage = Object.fromEntries(
        Object.entries(paths).map(([absolute, data]) => {
            const path = absolute.slice(root.length + 1);
            const file = asRecord(data, 'merged file coverage');
            if (!absolute.startsWith(`${root}/`) || file.path !== absolute || !production.delete(path)) {
                throw new Error(`Invalid merged coverage path: ${JSON.stringify(absolute)}`);
            }
            return [path, { ...file, path }];
        })
    );
    const changed = changedProductionLines(root, firstParent, revision);
    const missingExecutable: string[] = [];
    for (const path of production) {
        if (hasNoInstrumentableBody(root, revision, path)) {
            changed.delete(path);
        } else {
            missingExecutable.push(JSON.stringify(path));
        }
    }
    if (missingExecutable.length > 0) {
        throw new Error(`Merged coverage omitted production files: ${missingExecutable.join(', ')}`);
    }
    const previous = floorsAt(root, firstParent);
    const proposed = floorsAt(root, revision);
    const result = evaluateUnitCoverage(coverage, changed, previous, proposed);
    reportEvaluation(output, result, proposed, timings, {
        tested: revision,
        base: firstParent,
        head,
        runId: identity.runId,
        attempt: identity.attempt,
    });
    return result.failures.length === 0 ? 0 : 1;
}

if (
    process.argv[1] !== undefined &&
    basename(process.argv[1]) === 'unitCoverageGate.ts' &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        process.exitCode = await main();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
