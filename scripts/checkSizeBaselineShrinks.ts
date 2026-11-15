import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    describeSizeBaselineGrowth,
    findSizeBaselineGrowth,
    parseSizeBaselineFilesText,
    parseSizeCeilingsText,
    SIZE_CEILINGS_PATH,
} from './lintSizeCeilings.ts';

const BASE_REF = 'refs/remotes/origin/main';
const BASELINE_PATH = 'eslint.size-baseline.mjs';

function git(root: string, args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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

/** Compares the working tree's baseline and ceilings with the merge base's; returns one message per finding. */
export function checkSizeBaselineShrinks(root: string): string[] {
    const mergeBase = resolveMergeBase(root);
    const baseFiles = parseSizeBaselineFilesText(git(root, ['show', `${mergeBase}:${BASELINE_PATH}`]));
    const baseCeilings = parseSizeCeilingsText(git(root, ['show', `${mergeBase}:${SIZE_CEILINGS_PATH}`]));
    const headFiles = parseSizeBaselineFilesText(readFileSync(resolve(root, BASELINE_PATH), 'utf8'));
    const growth = findSizeBaselineGrowth(
        { baselineFiles: baseFiles, ceilings: baseCeilings },
        {
            baselineFiles: headFiles,
            ceilings: parseSizeCeilingsText(readFileSync(resolve(root, SIZE_CEILINGS_PATH), 'utf8')),
        }
    );
    return describeSizeBaselineGrowth(growth);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    try {
        const findings = checkSizeBaselineShrinks(root);
        if (findings.length > 0) {
            process.stderr.write(`${findings.join('\n')}\n`);
            process.exitCode = 1;
        } else {
            process.stdout.write('Size baseline only shrinks against the merge base.\n');
        }
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
