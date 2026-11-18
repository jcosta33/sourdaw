import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const COMPLEXITY_RULE = 'eslint/complexity';
const OXLINT = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url));

type FilePair = { path: string; base: string; head: string };
type Snapshot = { file: FilePair; source: string; scores: Map<string, number>; bytes: number };

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function complexityOptions(text: string): { options: unknown[]; maximum: number } {
    const config: unknown = JSON.parse(text);
    if (
        !record(config) ||
        'extends' in config ||
        (config.overrides !== undefined && !Array.isArray(config.overrides))
    ) {
        throw new Error('Complexity growth needs a direct Oxlint quality rule configuration.');
    }
    const overrides: unknown[] = config.overrides ?? [];
    const entries: unknown[] = [];
    for (const layer of [config, ...overrides]) {
        if (!record(layer) || !record(layer.rules)) {
            continue;
        }
        for (const name of ['complexity', COMPLEXITY_RULE]) {
            if (Object.hasOwn(layer.rules, name)) {
                entries.push(layer.rules[name]);
            }
        }
    }
    const rule = entries[0];
    const option: unknown = Array.isArray(rule) ? rule[1] : undefined;
    const maximum = record(option) ? option.max : option;
    if (
        entries.length !== 1 ||
        !Array.isArray(rule) ||
        rule.length !== 2 ||
        typeof maximum !== 'number' ||
        !Number.isSafeInteger(maximum) ||
        maximum < 0
    ) {
        throw new Error('Complexity growth needs one Oxlint quality complexity rule with an explicit maximum.');
    }
    return { options: ['error', option], maximum };
}

function spanKey(start: number, end: number): string {
    return `${start}:${end}`;
}

function readScore(entry: unknown, snapshots: ReadonlyMap<string, Snapshot>, root: string, maximum: number): void {
    const snapshot =
        record(entry) && typeof entry.filename === 'string' ? snapshots.get(resolve(root, entry.filename)) : undefined;
    if (
        !record(entry) ||
        entry.code !== 'eslint(complexity)' ||
        entry.severity !== 'error' ||
        typeof entry.message !== 'string' ||
        !Array.isArray(entry.labels) ||
        entry.labels.length !== 1
    ) {
        const path = snapshot === undefined ? '' : ` in ${snapshot.file.path}`;
        throw new Error(`Unexpected Oxlint complexity diagnostic${path}: ${JSON.stringify(entry)}`);
    }
    const match = /\bhas a complexity of (\d+)\. Maximum allowed is (\d+)\.$/.exec(entry.message);
    const score = Number(match?.[1]);
    const label: unknown = entry.labels[0];
    const span = record(label) && record(label.span) ? label.span : undefined;
    const start = span?.offset;
    const length = span?.length;
    if (
        snapshot === undefined ||
        Number(match?.[2]) !== maximum ||
        !Number.isSafeInteger(score) ||
        score <= maximum ||
        typeof start !== 'number' ||
        !Number.isSafeInteger(start) ||
        start < 0 ||
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        start + length > snapshot.bytes
    ) {
        throw new Error(
            `Invalid Oxlint complexity score or span: ${snapshot?.file.path ?? JSON.stringify(entry.filename)}: ${entry.message}`
        );
    }
    const key = spanKey(start, start + length);
    if (snapshot.scores.has(key)) {
        throw new Error(`Duplicate Oxlint complexity span: ${snapshot.file.path}: ${key}`);
    }
    snapshot.scores.set(key, score);
}

function scoreRevision(
    directory: string,
    config: string,
    maximum: number,
    files: readonly FilePair[],
    side: 'base' | 'head'
): Snapshot[] {
    mkdirSync(directory);
    const snapshots = new Map<string, Snapshot>();
    for (const [index, file] of files.entries()) {
        const path = join(directory, `${index}${extname(file.path)}`);
        const source = file[side];
        writeFileSync(path, source);
        snapshots.set(path, { file, source, scores: new Map(), bytes: Buffer.byteLength(source) });
    }
    const result = spawnSync(
        process.execPath,
        [
            OXLINT,
            '--disable-nested-config',
            '--no-ignore',
            '--threads=2',
            '--format=json',
            '--config',
            config,
            ...Array.from(snapshots.keys(), (path) => basename(path)),
        ],
        { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    if (result.error !== undefined || (result.status !== 0 && result.status !== 1) || result.stderr.trim() !== '') {
        throw new Error(
            `Oxlint complexity scoring failed for ${side}: ${result.error?.message ?? result.stderr.trim()} (${result.signal ?? result.status})`
        );
    }

    const report: unknown = JSON.parse(result.stdout);
    if (
        !record(report) ||
        report.number_of_files !== files.length ||
        report.number_of_rules !== 1 ||
        !Array.isArray(report.diagnostics) ||
        result.status !== Number(report.diagnostics.length > 0)
    ) {
        throw new Error(
            `Oxlint complexity report for ${side} has an unexpected file count, rule count, or exit status.`
        );
    }
    for (const diagnostic of report.diagnostics) {
        readScore(diagnostic, snapshots, directory, maximum);
    }
    return [...snapshots.values()];
}

function scoresByFunction(snapshot: Snapshot): Map<string, number> {
    const { file, source, scores } = snapshot;
    const parsed = ts.createSourceFile(file.path, source, ts.ScriptTarget.Latest);
    const named = new Map<string, number | undefined>();
    const add = (key: string, start: number, end: number) => {
        // Native offsets count UTF-8 bytes. Match both ends because nested concise arrows can share an end.
        const span = spanKey(Buffer.byteLength(source.slice(0, start)), Buffer.byteLength(source.slice(0, end)));
        named.set(key, named.has(key) ? undefined : scores.get(span));
    };
    for (const statement of parsed.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
            // Oxlint spans start at async or function and omit export/default modifiers.
            const first =
                statement.modifiers?.find((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ??
                statement.getChildren(parsed).find((child) => child.kind === ts.SyntaxKind.FunctionKeyword);
            if (first !== undefined) {
                add(`function ${statement.name.text}`, first.getStart(parsed), statement.end);
            }
        }
        if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0) {
            for (const { name, initializer } of statement.declarationList.declarations) {
                if (ts.isIdentifier(name) && initializer && ts.isArrowFunction(initializer)) {
                    add(`const ${name.text} arrow`, initializer.getStart(parsed), initializer.end);
                }
                if (ts.isIdentifier(name) && initializer && ts.isFunctionExpression(initializer)) {
                    add(`const ${name.text} function`, initializer.getStart(parsed), initializer.end);
                }
            }
        }
    }
    const matched = new Map<string, number>();
    for (const [key, score] of named) {
        if (score !== undefined) {
            matched.set(key, score);
        }
    }
    return matched;
}

/** Compare native over-cap scores only where top-level function identity is unambiguous on both sides. */
export function findComplexityGrowth(qualityConfig: string, files: readonly FilePair[]): string[] {
    const { options, maximum } = complexityOptions(qualityConfig);
    const directory = mkdtempSync(join(tmpdir(), 'lint-complexity-'));
    try {
        const config = join(directory, 'config.json');
        writeFileSync(
            config,
            JSON.stringify({
                categories: {
                    correctness: 'off',
                    suspicious: 'off',
                    pedantic: 'off',
                    perf: 'off',
                    style: 'off',
                    restriction: 'off',
                    nursery: 'off',
                },
                rules: { [COMPLEXITY_RULE]: options },
            })
        );
        const base = scoreRevision(join(directory, 'base'), config, maximum, files, 'base');
        const head = scoreRevision(join(directory, 'head'), config, maximum, files, 'head');
        const previous = new Map(base.map((snapshot) => [snapshot.file.path, scoresByFunction(snapshot)]));
        const findings: string[] = [];
        for (const snapshot of head) {
            const { path } = snapshot.file;
            for (const [name, score] of scoresByFunction(snapshot)) {
                const earlier = previous.get(path)?.get(name);
                if (earlier !== undefined && score > earlier) {
                    findings.push(
                        `${path}: ${name} complexity increased from ${earlier} to ${score} (maximum ${maximum}).`
                    );
                }
            }
        }
        return findings;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
