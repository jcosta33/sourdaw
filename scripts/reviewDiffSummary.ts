import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { wasmArtifacts } from './wasm-artifacts.ts';

export type ReviewDiffGroup = 'handwritten' | 'tests' | 'docs' | 'generated';

export type ReviewDiffCount = {
    files: number;
    added: number;
    deleted: number;
    binaryFiles: number;
};

export type ReviewDiffSummary = ReviewDiffCount & {
    groups: Record<ReviewDiffGroup, ReviewDiffCount>;
};

export type ReviewChangedPath = {
    path: string;
    group: ReviewDiffGroup;
    added: number;
    deleted: number;
    binary: boolean;
    /**
     * The source path of a rename or copy record, classified like `path`, present only on rename
     * records: one numstat record is one changed file, and every consumer counts it once, while
     * scope decisions read both paths — the product-scope gate must see a file moved out of a
     * product tree exactly as it sees that file deleted.
     */
    previous?: { path: string; group: ReviewDiffGroup };
};

type NumstatEntry = {
    added: number;
    deleted: number;
    binary: boolean;
    path: string;
    previousPath?: string;
};

const lockFiles = new Set(['Cargo.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);

function emptyCount(): ReviewDiffCount {
    return { files: 0, added: 0, deleted: 0, binaryFiles: 0 };
}

function parseCount(value: string, path: string): { count: number; binary: boolean } {
    if (value === '-') {
        return { count: 0, binary: true };
    }
    if (!/^[0-9]+$/u.test(value)) {
        throw new Error(`invalid numstat count for ${path}`);
    }
    return { count: Number(value), binary: false };
}

function parseNumstat(numstat: Buffer): NumstatEntry[] {
    const fields = numstat.toString('utf8').split('\0');
    const entries: NumstatEntry[] = [];
    let index = 0;
    while (index < fields.length && fields[index] !== '') {
        const record = fields[index] ?? '';
        index += 1;
        const firstTab = record.indexOf('\t');
        const secondTab = record.indexOf('\t', firstTab + 1);
        if (firstTab < 0 || secondTab < 0) {
            throw new Error('invalid NUL-delimited numstat record');
        }
        const addedText = record.slice(0, firstTab);
        const deletedText = record.slice(firstTab + 1, secondTab);
        const pathText = record.slice(secondTab + 1);
        // A rename or copy record carries its empty path slot, then the old and new paths as the
        // next two NUL fields. Both name one changed file, so both must reach the consumers that
        // classify paths; keeping only the destination hid a product-tree source from the scope
        // gates (#4743).
        let previousPath: string | undefined;
        let path: string;
        if (pathText === '') {
            const source = fields[index];
            const destination = fields[index + 1];
            if (source === undefined || destination === undefined || source === '' || destination === '') {
                throw new Error('invalid NUL-delimited numstat rename');
            }
            previousPath = source;
            path = destination;
            index += 2;
        } else {
            path = pathText;
        }
        const added = parseCount(addedText, path);
        const deleted = parseCount(deletedText, path);
        const entry: NumstatEntry = {
            added: added.count,
            deleted: deleted.count,
            binary: added.binary || deleted.binary,
            path,
        };
        if (previousPath !== undefined) {
            entry.previousPath = previousPath;
        }
        entries.push(entry);
    }
    return entries;
}

function attributeGeneratedPaths(root: string): Set<string> {
    let contents: string;
    try {
        contents = readFileSync(join(root, '.gitattributes'), 'utf8');
    } catch {
        return new Set();
    }
    const paths = new Set<string>();
    for (const line of contents.split('\n')) {
        const fields = line.trim().split(/\s+/u);
        const path = fields[0];
        if (path !== undefined && fields.includes('linguist-generated=true') && !path.includes('*')) {
            paths.add(path);
        }
    }
    return paths;
}

function wasmGeneratedPaths(): Set<string> {
    return new Set(['public/wasm/manifest.json', ...wasmArtifacts.packages.flatMap((pkg) => pkg.artifacts)]);
}

function isTest(path: string): boolean {
    return path.split('/').includes('__tests__') || /(?:^|\/)[^/]+\.(?:spec|test)\.[^.]+$/u.test(path);
}

function isDocumentation(path: string): boolean {
    return path.startsWith('docs/') || /\.mdx?$/u.test(path);
}

function classifyPath(path: string, generatedPaths: ReadonlySet<string>): ReviewDiffGroup {
    if (isTest(path)) {
        return 'tests';
    }
    if (lockFiles.has(basename(path)) || generatedPaths.has(path)) {
        return 'generated';
    }
    if (isDocumentation(path)) {
        return 'docs';
    }
    return 'handwritten';
}

function addEntry(count: ReviewDiffCount, entry: { added: number; deleted: number; binary: boolean }): void {
    count.files += 1;
    count.added += entry.added;
    count.deleted += entry.deleted;
    count.binaryFiles += entry.binary ? 1 : 0;
}

export function changedReviewPaths(root: string, numstat: Buffer): ReviewChangedPath[] {
    const generatedPaths = new Set([...attributeGeneratedPaths(root), ...wasmGeneratedPaths()]);
    return parseNumstat(numstat).map((entry) => {
        const changed: ReviewChangedPath = {
            path: entry.path,
            group: classifyPath(entry.path, generatedPaths),
            added: entry.added,
            deleted: entry.deleted,
            binary: entry.binary,
        };
        if (entry.previousPath !== undefined) {
            changed.previous = {
                path: entry.previousPath,
                group: classifyPath(entry.previousPath, generatedPaths),
            };
        }
        return changed;
    });
}

export function summarizeReviewDiff(root: string, numstat: Buffer): ReviewDiffSummary {
    const groups: Record<ReviewDiffGroup, ReviewDiffCount> = {
        handwritten: emptyCount(),
        tests: emptyCount(),
        docs: emptyCount(),
        generated: emptyCount(),
    };
    const summary: ReviewDiffSummary = { ...emptyCount(), groups };
    for (const entry of changedReviewPaths(root, numstat)) {
        addEntry(summary, entry);
        addEntry(groups[entry.group], entry);
    }
    return summary;
}

export function formatReviewDiffSummary(summary: ReviewDiffSummary): string {
    return JSON.stringify(summary);
}
