import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import {
    CRASH_EVIDENCE_LIMIT,
    CRASH_REPORT_LIMIT,
    crashEvidenceDirectory,
    crashReportNames,
    isRecord,
    readBoundedCrashFile,
    userCrashReportsDirectory,
    writeCrashJson,
} from './browserAiMacCrashEvidence.ts';

const COLLECTOR_BUDGET_MS = 5_000;
const CAPTURE_AFTER_EXIT_MS = 5_000;
const SCAN_RESERVE_MS = 250;
const REPORT_SIZE_LIMIT = 1024 * 1024;
const CANDIDATE_LIMIT = 32;
const FRAME_LIMIT = 64;
const UUID_PATTERN = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const SUMMARY_FILENAME = 'vite-native-crash.json';

type CrashLaunch = {
    runId: string;
    pid: number;
    parentPid: number;
    executable: string;
    launchBefore: number;
    launchAfter: number;
    previousReports: ReadonlySet<string>;
};

type CrashIdentity = CrashLaunch & { exitedAt: number };

type MatchedReport = { report: Record<string, unknown>; launchedAt: number; capturedAt: number };
type RedactedExecutable = { name: string; path: string; uuid: string };
type CollectorOptions = {
    waitMs?: number;
    lookupMachOUuid?: (executable: string) => string | undefined;
};

type Frame = {
    image?: string;
    uuid?: string;
    imageOffset: number;
    symbol?: string;
    symbolLocation?: number;
};

type CollectionResult =
    | 'saved'
    | 'missing-crash-evidence'
    | 'no-unexpected-crash'
    | 'report-scan-limit'
    | 'collector-budget-exhausted'
    | 'no-matching-report'
    | 'ambiguous-report'
    | 'unusable-stack'
    | 'collector-error';

function nonnegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function timestamp(value: unknown): value is number {
    return nonnegativeInteger(value) && value > 0 && value <= 8.64e15;
}

function ipsNames(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.length <= CRASH_REPORT_LIMIT &&
        value.every((name: unknown) => typeof name === 'string' && basename(name) === name && name.endsWith('.ips'))
    );
}

function jsonRecord(text: string | undefined): Record<string, unknown> | undefined {
    if (text === undefined) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(text);
        return isRecord(parsed) ? parsed : undefined;
    } catch (error) {
        if (error instanceof SyntaxError) {
            return undefined;
        }
        throw error;
    }
}

function readLaunch(directory: string): CrashLaunch | undefined {
    const start = jsonRecord(readBoundedCrashFile(join(directory, 'start.json'), CRASH_EVIDENCE_LIMIT, true));
    if (!start) {
        return undefined;
    }
    const { pid, parentPid, launchBefore, launchAfter, executable, reportNames, runId } = start;
    if (
        typeof runId !== 'string' ||
        !UUID_PATTERN.test(runId) ||
        !nonnegativeInteger(pid) ||
        pid === 0 ||
        !nonnegativeInteger(parentPid) ||
        parentPid === 0 ||
        pid === parentPid ||
        typeof executable !== 'string' ||
        executable.length > 4096 ||
        !isAbsolute(executable) ||
        !timestamp(launchBefore) ||
        !timestamp(launchAfter) ||
        launchAfter < launchBefore ||
        !ipsNames(reportNames)
    ) {
        return undefined;
    }
    return { runId, pid, parentPid, executable, launchBefore, launchAfter, previousReports: new Set(reportNames) };
}

function readIdentity(directory: string): CrashIdentity | 'missing-crash-evidence' | 'no-unexpected-crash' {
    const start = readLaunch(directory);
    const exit = jsonRecord(readBoundedCrashFile(join(directory, 'exit.json'), CRASH_EVIDENCE_LIMIT, true));
    if (!start || !exit) {
        return 'missing-crash-evidence';
    }
    const { exitedAt } = exit;
    if (
        exit.runId !== start.runId ||
        exit.pid !== start.pid ||
        !timestamp(exitedAt) ||
        exitedAt < start.launchAfter ||
        typeof exit.planned !== 'boolean'
    ) {
        return 'missing-crash-evidence';
    }
    if (
        exit.planned ||
        !((exit.code === null && exit.signal === 'SIGSEGV') || (exit.code === 139 && exit.signal === null))
    ) {
        return 'no-unexpected-crash';
    }
    return { ...start, exitedAt };
}

// IPS timestamps use a space and an offset without a colon. Date.parse is used
// only on canonicalized input and we retain milliseconds from Apple's fractional time.
function ipsTime(value: unknown): number | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{2,6}) ([+-]\d{2})(\d{2})$/.exec(value);
    if (!match) {
        return undefined;
    }
    const [, day, time, fraction, offsetHour, offsetMinutes] = match;
    if (!day || !time || !fraction || !offsetHour || !offsetMinutes) {
        return undefined;
    }
    const localTime = `${day}T${time}`;
    const utc = Date.parse(`${localTime}Z`);
    if (!timestamp(utc) || new Date(utc).toISOString().slice(0, 19) !== localTime) {
        return undefined;
    }
    const timestampMs = Date.parse(`${localTime}.${fraction.slice(0, 3).padEnd(3, '0')}${offsetHour}:${offsetMinutes}`);
    return timestamp(timestampMs) ? timestampMs : undefined;
}

function readMachOUuid(executable: string): string | undefined {
    const architecture = process.arch === 'x64' ? 'x86_64' : process.arch;
    if (process.platform !== 'darwin' || realpathSync(process.execPath) !== executable) {
        return undefined;
    }
    const result = spawnSync('/usr/bin/dwarfdump', ['--uuid', executable], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1_000,
        killSignal: 'SIGKILL',
        maxBuffer: 8_192,
    });
    if (result.error || result.status !== 0) {
        return undefined;
    }
    const matches = Array.from(result.stdout.matchAll(/^UUID: (\S+) \((\w+)\) /gm)).filter(
        (match) => match[2] === architecture
    );
    const uuid = matches[0]?.[1];
    return matches.length === 1 && uuid && UUID_PATTERN.test(uuid) ? uuid.toLowerCase() : undefined;
}

function redactedExecutable(
    executable: string,
    reports: string,
    lookupMachOUuid: NonNullable<CollectorOptions['lookupMachOUuid']>
): RedactedExecutable | undefined {
    const home = resolve(reports, '../../..');
    if (!executable.startsWith(`${home}${sep}`)) {
        return undefined;
    }
    const uuid = lookupMachOUuid(executable);
    if (!uuid || !UUID_PATTERN.test(uuid)) {
        return undefined;
    }
    const name = basename(executable);
    return { name, path: join(home, '*', name), uuid: uuid.toLowerCase() };
}

function matchingExecutable(
    report: Record<string, unknown>,
    executable: string,
    redacted: RedactedExecutable | undefined
): boolean {
    if (report.procPath === executable) {
        return true;
    }
    if (!redacted || report.procPath !== redacted.path || !Array.isArray(report.usedImages)) {
        return false;
    }
    // macOS masks user-home paths. Tie that exact form to the unique process
    // image and the observed executable's own Mach-O slice.
    const images = report.usedImages.filter(
        (image: unknown) =>
            isRecord(image) && image.source === 'P' && image.name === redacted.name && image.path === redacted.path
    );
    const image: unknown = images[0];
    return (
        images.length === 1 &&
        isRecord(image) &&
        typeof image.uuid === 'string' &&
        image.uuid.toLowerCase() === redacted.uuid
    );
}

function matchingTimes(
    report: Record<string, unknown>,
    identity: CrashIdentity,
    observedAt: number
): Pick<MatchedReport, 'launchedAt' | 'capturedAt'> | undefined {
    const launchedAt = ipsTime(report.procLaunch);
    const capturedAt = ipsTime(report.captureTime);
    // CrashReporter can timestamp an exited process before publishing its report.
    // Allow the observation window plus the clocks' sub-millisecond precision.
    if (
        launchedAt === undefined ||
        capturedAt === undefined ||
        launchedAt < identity.launchBefore - 1 ||
        launchedAt > identity.exitedAt + 1 ||
        capturedAt < launchedAt ||
        capturedAt > Math.min(identity.exitedAt + CAPTURE_AFTER_EXIT_MS, observedAt) + 1
    ) {
        return undefined;
    }
    return { launchedAt, capturedAt };
}

function isFatalSegmentationFault(report: Record<string, unknown>): boolean {
    return (
        isRecord(report.exception) &&
        report.exception.signal === 'SIGSEGV' &&
        report.isNonFatal !== true &&
        report.isNonFatal !== 'true' &&
        report.isSimulated !== true &&
        report.isSimulated !== 'true'
    );
}

function matchingReport(
    content: string | undefined,
    identity: CrashIdentity,
    redacted: RedactedExecutable | undefined,
    observedAt: number
): MatchedReport | undefined {
    if (!content) {
        return undefined;
    }
    const lineEnd = content.indexOf('\n');
    if (lineEnd < 1) {
        return undefined;
    }
    const metadata = jsonRecord(content.slice(0, lineEnd));
    const name = basename(identity.executable);
    if (
        metadata?.bug_type !== '309' ||
        (metadata.app_name ?? metadata.name) !== name ||
        (metadata.name !== undefined && metadata.name !== name)
    ) {
        return undefined;
    }
    const report = jsonRecord(content.slice(lineEnd + 1));
    if (
        !report ||
        report.pid !== identity.pid ||
        report.parentPid !== identity.parentPid ||
        report.procName !== name ||
        !isFatalSegmentationFault(report) ||
        !matchingExecutable(report, identity.executable, redacted)
    ) {
        return undefined;
    }
    const times = matchingTimes(report, identity, observedAt);
    return times ? { report, ...times } : undefined;
}

function projectedFrame(value: unknown, images: readonly unknown[]): Frame | undefined {
    if (
        !isRecord(value) ||
        !nonnegativeInteger(value.imageIndex) ||
        value.imageIndex >= images.length ||
        !nonnegativeInteger(value.imageOffset)
    ) {
        return undefined;
    }
    const frame: Frame = { imageOffset: value.imageOffset };
    const image = images[value.imageIndex];
    if (isRecord(image)) {
        if (typeof image.name === 'string' && /^[a-z\d_][a-z\d_.+-]{0,127}$/i.test(image.name)) {
            frame.image = image.name;
        }
        if (typeof image.uuid === 'string' && UUID_PATTERN.test(image.uuid)) {
            frame.uuid = image.uuid;
        }
    }
    if (typeof value.symbol === 'string' && /^[a-z_.$?][a-z\d_.$:?<>~+*-]{0,159}$/i.test(value.symbol)) {
        frame.symbol = value.symbol;
        if (nonnegativeInteger(value.symbolLocation)) {
            frame.symbolLocation = value.symbolLocation;
        }
    }
    return frame;
}

function faultingFrames(report: Record<string, unknown>): Frame[] {
    const { faultingThread, threads, usedImages } = report;
    if (!nonnegativeInteger(faultingThread) || !Array.isArray(threads) || !Array.isArray(usedImages)) {
        return [];
    }
    const thread: unknown = threads[faultingThread];
    if (!isRecord(thread) || !Array.isArray(thread.frames)) {
        return [];
    }
    return thread.frames.slice(0, FRAME_LIMIT).flatMap((value: unknown) => projectedFrame(value, usedImages) ?? []);
}

export async function collectBrowserAiMacCrashSummary(
    directory: string,
    reports: string,
    { waitMs = COLLECTOR_BUDGET_MS, lookupMachOUuid = readMachOUuid }: CollectorOptions = {}
): Promise<CollectionResult> {
    const budget = Math.min(waitMs, COLLECTOR_BUDGET_MS);
    const deadline = performance.now() + budget;
    try {
        const identity = readIdentity(directory);
        if (typeof identity === 'string') {
            return identity;
        }
        const redacted = redactedExecutable(identity.executable, reports, lookupMachOUuid);
        // Use one directory snapshot near the deadline to admit a late report or
        // detect a second match. Reserve part of this budget to scan and publish.
        const pause = deadline - performance.now() - Math.min(SCAN_RESERVE_MS, budget / 2);
        if (pause > 0) {
            await delay(pause);
        }
        if (budget > 0 && performance.now() >= deadline) {
            return 'collector-budget-exhausted';
        }
        const candidates = crashReportNames(reports).filter((name) => !identity.previousReports.has(name));
        if (candidates.length > CANDIDATE_LIMIT) {
            return 'report-scan-limit';
        }
        let match: MatchedReport | undefined;
        for (const name of candidates) {
            if (budget > 0 && performance.now() >= deadline) {
                return 'collector-budget-exhausted';
            }
            const content = readBoundedCrashFile(join(reports, name), REPORT_SIZE_LIMIT);
            const candidate = matchingReport(content, identity, redacted, Date.now());
            if (!candidate) {
                continue;
            }
            if (match) {
                return 'ambiguous-report';
            }
            match = candidate;
        }
        if (!match) {
            return 'no-matching-report';
        }
        const frames = faultingFrames(match.report);
        if (frames.length === 0) {
            return 'unusable-stack';
        }
        if (budget > 0 && performance.now() >= deadline) {
            return 'collector-budget-exhausted';
        }
        writeCrashJson(directory, SUMMARY_FILENAME, {
            signal: 'SIGSEGV',
            pid: identity.pid,
            launchedAt: new Date(match.launchedAt).toISOString(),
            capturedAt: new Date(match.capturedAt).toISOString(),
            exitedAt: new Date(identity.exitedAt).toISOString(),
            frames,
        });
        return 'saved';
    } catch {
        return 'collector-error';
    }
}

export function exportBrowserAiMacCrashSummary(directory: string): void {
    copyFileSync(join(directory, SUMMARY_FILENAME), SUMMARY_FILENAME, constants.COPYFILE_EXCL);
}

async function main(): Promise<number> {
    try {
        const directory = crashEvidenceDirectory();
        if (!directory || process.platform !== 'darwin') {
            return 1;
        }
        const result = await collectBrowserAiMacCrashSummary(directory, userCrashReportsDirectory());
        if (result === 'saved') {
            exportBrowserAiMacCrashSummary(directory);
        }
        console.log(`[browser-ai-webgpu] native crash summary: ${result}`);
        return result === 'saved' ? 0 : 1;
    } catch {
        console.log('[browser-ai-webgpu] native crash summary: collector-error');
        return 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    process.exitCode = await main();
}
