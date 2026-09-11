#!/usr/bin/env node

/**
 * Does the agent workspace actually work in the app we ship?
 *
 * The browser E2E (`tests/e2e/agentWorkspace.spec.ts`) proves the workspace
 * in the standalone-browser reference host. This is the other one: the
 * `electron-builder` artefact, launched the way a musician launches it and
 * driven over the Chrome DevTools Protocol through the product's own UI —
 * Preferences, the chat composer, the Agent bottom tab, and the workspace's
 * own approval, comparison and revert controls.
 *
 * Neither host is given a test-only privilege. The packaged renderer cannot
 * dynamic-import `/src/...` and the preload exposes no test hook, so the
 * provider this run admits is admitted through the Preferences form, against
 * a real OpenAI-compatible endpoint this process starts on loopback. The
 * packaged Content-Security-Policy already admits `http://127.0.0.1:*` for
 * `connect-src` (`electron/protocol.ts`), so nothing about the shipped shell
 * is relaxed for the run either.
 *
 * Why no Vitest or Playwright test can answer this
 * ------------------------------------------------
 * The question is about the shipped artefact: the packaged renderer's own
 * module graph (no `/src/...` to import), the packaged CSP, the desktop-only
 * hosted-provider branch of the Preferences AI section, and the desktop
 * project pipeline underneath the workspace's confirm and revert. None of
 * those exist in jsdom, and none of them are what the dev server serves.
 *
 *   0  PROVEN   — every workspace step observed the state it names.
 *   1  FAILED   — a workspace step observed the wrong state. The record names
 *                 the step and what was seen.
 *   2  NOT RUN  — a precondition or the launch did not hold. Nothing was
 *                 driven and nothing is claimed. Every path out of `main()`
 *                 and every otherwise-uncaught exception maps here rather
 *                 than falling through to Node's own default exit 1, which
 *                 this contract reserves for the one designed FAILED verdict.
 *
 * Usage: `pnpm desktop:agent-proof [--app <path>] [--json <path>]`. A verdict
 * without its machine is not evidence, so the record carries the operator
 * checkout's git sha and the measured artefact's own payload hash alongside
 * the steps.
 */

import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { driveAgentWorkspaceProof, type ProofStep } from './desktopAgentWorkspaceDrive.ts';
import { emptyDiagnostics } from './desktopLatencyDiagnostics.ts';
import { DEFAULT_APP_PATH } from './desktopLatencyReadings.ts';
import { machineProvenance, readPayloadIdentity, writeRecord, type PayloadIdentity } from './desktopLatencyRecord.ts';
import { startLoopbackOpenAiProvider, type LoopbackOpenAiProvider } from './loopbackOpenAiProvider.ts';
import { launchPackagedApp } from './packagedAppSession.ts';

const EXIT_PROVEN = 0;
const EXIT_FAILED = 1;
const EXIT_NOT_RUN = 2;

/** A fresh, per-run Electron profile — never the operator's own `~/Library/Application Support/sourdaw`. */
const PROFILE_DIR_PREFIX = 'sourdaw-agent-proof-';

const REPLY = 'Loopback provider reply for the packaged agent workspace proof.';

export type AgentProofArgs = { appPath: string; jsonPath: string | null };

export type AgentProofVerdict = 'proven' | 'failed' | 'not-run';

export type AgentProofRecord = {
    schemaVersion: 1;
    checkoutGitSha: string;
    appPayloadSha256: string;
    startedAt: string;
    steps: ProofStep[];
    verdict: AgentProofVerdict;
    reason: string;
};

function readFlag(argv: readonly string[], flag: string): string | null {
    const index = argv.indexOf(flag);
    if (index === -1) {
        return null;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} needs a value`);
    }
    return value;
}

export function parseArgs(argv: readonly string[]): AgentProofArgs {
    return {
        appPath: readFlag(argv, '--app') ?? DEFAULT_APP_PATH,
        jsonPath: readFlag(argv, '--json'),
    };
}

/**
 * A run that took no step drove nothing, so it cannot claim a workspace
 * verdict; one whose every step held is PROVEN, and any failed step is the
 * FAILED verdict this contract reserves exit 1 for.
 */
export function decideVerdict(steps: readonly ProofStep[]): AgentProofVerdict {
    if (steps.length === 0) {
        return 'not-run';
    }
    return steps.every((entry) => entry.ok) ? 'proven' : 'failed';
}

export function describeVerdict(steps: readonly ProofStep[], verdict: AgentProofVerdict): string {
    if (verdict === 'proven') {
        return `every one of the ${String(steps.length)} workspace steps observed the state it names`;
    }
    if (verdict === 'not-run') {
        return 'the packaged app was never driven';
    }
    const failed = steps.find((entry) => !entry.ok);
    return `the step "${failed?.name ?? 'unknown'}" observed ${failed?.observed ?? 'nothing'}`;
}

export type BuildAgentProofRecordInput = {
    checkoutGitSha: string;
    payload: PayloadIdentity;
    startedAt: string;
    steps: readonly ProofStep[];
    verdict: AgentProofVerdict;
    reason: string;
};

export function buildAgentProofRecord(input: BuildAgentProofRecordInput): AgentProofRecord {
    return {
        schemaVersion: 1,
        checkoutGitSha: input.checkoutGitSha,
        appPayloadSha256: input.payload.sha256,
        startedAt: input.startedAt,
        steps: input.steps.map((entry) => ({ ...entry })),
        verdict: input.verdict,
        reason: input.reason,
    };
}

function notRun(reason: string): number {
    process.stdout.write(`\nNOT RUN: ${reason}\n`);
    return EXIT_NOT_RUN;
}

function reportSteps(steps: readonly ProofStep[]): void {
    for (const entry of steps) {
        process.stdout.write(`  ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name} — ${entry.observed}\n`);
    }
}

async function runProof(binary: string, profileDir: string, provider: LoopbackOpenAiProvider): Promise<ProofStep[]> {
    const diagnostics = emptyDiagnostics();
    const app = await launchPackagedApp(binary, profileDir, diagnostics);
    try {
        return await driveAgentWorkspaceProof(app.page, provider);
    } finally {
        await app.quit();
    }
}

async function main(): Promise<number> {
    let args: AgentProofArgs;
    try {
        args = parseArgs(process.argv);
    } catch (error) {
        return notRun(error instanceof Error ? error.message : String(error));
    }

    const binary = resolve(args.appPath, 'Contents/MacOS/Sourdaw');
    const machine = machineProvenance();

    process.stdout.write('Packaged desktop agent workspace proof\n');
    process.stdout.write('======================================\n');
    process.stdout.write(`checkout          ${machine.checkoutGitSha} (${machine.workingTree})\n`);
    process.stdout.write(`app               ${args.appPath}\n`);

    if (!existsSync(binary)) {
        return notRun(`there is no packaged app binary at ${binary}. Run \`pnpm desktop:build\`.`);
    }
    let payload: PayloadIdentity;
    try {
        payload = readPayloadIdentity(args.appPath, process.platform);
    } catch (error) {
        return notRun(error instanceof Error ? error.message : String(error));
    }
    process.stdout.write(`app payload       sha256:${payload.sha256} mtime:${payload.mtime}\n`);

    const provider = await startLoopbackOpenAiProvider({ reply: REPLY });
    process.stdout.write(`provider          ${provider.baseUrl} (model ${provider.model})\n`);

    const profileDir = mkdtempSync(join(tmpdir(), PROFILE_DIR_PREFIX));
    process.stdout.write(`profile           isolated (${profileDir})\n`);

    const startedAt = new Date().toISOString();
    let steps: ProofStep[];
    try {
        steps = await runProof(binary, profileDir, provider);
    } catch (error) {
        return notRun(error instanceof Error ? error.message : String(error));
    } finally {
        await provider.close();
    }

    reportSteps(steps);
    const verdict = decideVerdict(steps);
    const reason = describeVerdict(steps, verdict);
    process.stdout.write(`\nVERDICT ${verdict.toUpperCase().replace('-', ' ')} — ${reason}\n`);

    if (args.jsonPath !== null) {
        try {
            writeRecord(
                args.jsonPath,
                buildAgentProofRecord({
                    checkoutGitSha: machine.checkoutGitSha,
                    payload,
                    startedAt,
                    steps,
                    verdict,
                    reason,
                })
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return notRun(`the run drove the workspace but the record could not be written: ${message}`);
        }
    }

    if (verdict === 'proven') {
        return EXIT_PROVEN;
    }
    return verdict === 'failed' ? EXIT_FAILED : EXIT_NOT_RUN;
}

// The pure helpers above are unit-tested, so importing this file must not
// launch a packaged app. `realpathSync`, because the ESM loader realpaths
// `import.meta.url` while `argv[1]` keeps any symlink — see
// `scripts/measureDesktopLatency.ts`, which carries the same guard.
const invokedPath = process.argv[1] === undefined ? '' : realpathSync(resolve(process.argv[1]));
if (invokedPath === fileURLToPath(import.meta.url)) {
    // Defense in depth on top of `main()`'s own internal NOT RUN mapping:
    // this script's contract reserves exit 1 for the one designed FAILED
    // verdict. An uncaught exception has no verdict of its own, and Node's
    // default handling for one is also exit 1 — indistinguishable from that
    // FAILED verdict unless every throw `main()` does not already catch is
    // mapped here instead.
    try {
        process.exitCode = await main();
    } catch (error) {
        process.stdout.write(`\nNOT RUN: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = EXIT_NOT_RUN;
    }
}
