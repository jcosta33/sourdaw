import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    findQualityBudgetGrowth,
    parseConfiguredQualityRules,
    parseQualityBudget,
    QUALITY_BUDGET,
    QUALITY_CONFIG,
    readQualityBudget,
} from './lintQualityBudget.ts';
import {
    describeSizeBaselineGrowth,
    findSizeBaselineGrowth,
    GENERATED_SIZE_EXEMPTIONS,
    parseSizeBaselineFilesText,
    parseSizeCeilingsText,
    SIZE_CEILINGS_PATH,
} from './lintSizeCeilings.ts';

const BASE_REF = 'refs/remotes/origin/main';
const BASELINE_PATH = 'eslint.size-baseline.mjs';
function git(root: string, args: string[]): string {
    return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
    });
}

function resolveMergeBase(root: string): string {
    try {
        git(root, ['rev-parse', '--verify', '--quiet', BASE_REF]);
    } catch {
        throw new Error(
            `${BASE_REF} is missing; fetch origin/main with full history so the size baseline can be compared.`
        );
    }
    try {
        return git(root, ['merge-base', 'HEAD', BASE_REF]).trim();
    } catch {
        throw new Error(`no merge base between HEAD and ${BASE_REF}; fetch full history.`);
    }
}

function existsAtCommit(root: string, commit: string, path: string): boolean {
    return git(root, ['ls-tree', '--name-only', commit, '--', path]).trim() !== '';
}

/** A ceilings file absent on a side reads as an empty ledger; any other read or parse failure still throws. */
function readBaseCeilings(root: string, mergeBase: string): Record<string, number> {
    if (!existsAtCommit(root, mergeBase, SIZE_CEILINGS_PATH)) {
        return {};
    }
    return parseSizeCeilingsText(git(root, ['show', `${mergeBase}:${SIZE_CEILINGS_PATH}`]));
}

function readHeadCeilings(root: string): Record<string, number> {
    const path = resolve(root, SIZE_CEILINGS_PATH);
    return existsSync(path) ? parseSizeCeilingsText(readFileSync(path, 'utf8')) : {};
}

/** A seam for hosts whose module resolver cannot import a file outside its root (a spec's temporary repository). */
export type ModuleLoader = (absolutePath: string) => Promise<unknown>;

const importModule: ModuleLoader = (absolutePath) => import(pathToFileURL(absolutePath).href);

/**
 * The head's list is the module's evaluated export, exactly what eslint.config.mjs imports, so no
 * expression form (concat, push, a decoy comment) can hide an entry from the comparison. An empty list is a
 * full burn-down. The import is cached per path, so each root is read once per process.
 */
async function readHeadBaselineFiles(root: string, load: ModuleLoader): Promise<string[]> {
    const loaded = await load(resolve(root, BASELINE_PATH));
    const files: unknown =
        typeof loaded === 'object' && loaded !== null ? Reflect.get(loaded, 'sizeBaselineFiles') : undefined;
    if (!Array.isArray(files) || !files.every((entry): entry is string => typeof entry === 'string')) {
        throw new Error(`${BASELINE_PATH} must export sizeBaselineFiles as an array of strings.`);
    }
    return files;
}

/** Compares the working tree's baseline and ceilings with the merge base's; returns one message per finding. */
export async function checkSizeBaselineShrinks(root: string, load: ModuleLoader = importModule): Promise<string[]> {
    const mergeBase = resolveMergeBase(root);
    const baseFiles = parseSizeBaselineFilesText(git(root, ['show', `${mergeBase}:${BASELINE_PATH}`]));
    const headFiles = await readHeadBaselineFiles(root, load);
    const growth = findSizeBaselineGrowth(
        { baselineFiles: baseFiles, ceilings: readBaseCeilings(root, mergeBase) },
        { baselineFiles: headFiles, ceilings: readHeadCeilings(root) },
        // CI runs the head's own script, so its declared exemptions are the head tree's.
        GENERATED_SIZE_EXEMPTIONS.map((exemption) => exemption.path)
    );
    return describeSizeBaselineGrowth(growth);
}

function trackedPaths(root: string, commit: string): string[] {
    return git(root, ['ls-tree', '-r', '--name-only', '-z', commit]).split('\0').filter(Boolean);
}

function qualityBudgetSeed(root: string, mergeBase: string) {
    const configPath = resolve(root, QUALITY_CONFIG);
    if (!existsSync(configPath)) {
        return undefined;
    }
    const { errors } = parseConfiguredQualityRules(readFileSync(configPath, 'utf8'), QUALITY_CONFIG);
    let baseConfig = '{}';
    if (existsAtCommit(root, mergeBase, QUALITY_CONFIG)) {
        baseConfig = git(root, ['show', `${mergeBase}:${QUALITY_CONFIG}`]);
    }
    const { present } = parseConfiguredQualityRules(baseConfig, `${mergeBase}:${QUALITY_CONFIG}`);
    const rules = errors.difference(present);
    if (rules.size === 0) {
        return undefined;
    }
    const modified = new Set(git(root, ['diff', '--name-only', '--no-renames', '-z', mergeBase, '--']).split('\0'));
    const files = new Set(trackedPaths(root, mergeBase).filter((file) => !modified.has(file)));
    return { rules, files };
}

/** Counts only shrink after a rule enters the quality pass. Its first counts may cover unchanged tracked files. */
export function checkQualityBudgetShrinks(root: string): string[] {
    const mergeBase = resolveMergeBase(root);
    const head = readQualityBudget(root);
    if (!existsAtCommit(root, mergeBase, QUALITY_BUDGET)) {
        const basePaths = new Set(trackedPaths(root, mergeBase));
        const findings: string[] = [];
        for (const file of head.keys()) {
            if (!basePaths.has(file)) {
                findings.push(`${file}: cannot seed a lint quality budget for a path absent at the merge base.`);
            }
        }
        return findings;
    }
    const base = parseQualityBudget(
        git(root, ['show', `${mergeBase}:${QUALITY_BUDGET}`]),
        `${mergeBase}:${QUALITY_BUDGET}`
    );
    return findQualityBudgetGrowth(base, head, qualityBudgetSeed(root, mergeBase));
}

/**
 * Whether `moduleUrl` is the script node was started with. The URL is built from the real path, never by
 * interpolating into `file://`, so a `#` or `%` in the checkout path or a symlinked entry still matches.
 */
export function isEntryModule(moduleUrl: string, entry: string | undefined): boolean {
    return entry !== undefined && moduleUrl === pathToFileURL(realpathSync(entry)).href;
}

if (isEntryModule(import.meta.url, process.argv[1])) {
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    try {
        const findings = [...(await checkSizeBaselineShrinks(root)), ...checkQualityBudgetShrinks(root)];
        if (findings.length > 0) {
            process.stderr.write(`${findings.join('\n')}\n`);
            process.exitCode = 1;
        } else {
            process.stdout.write('Size and lint quality baselines only shrink against the merge base.\n');
        }
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
