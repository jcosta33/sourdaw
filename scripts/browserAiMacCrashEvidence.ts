import { randomUUID } from 'node:crypto';
import {
    closeSync,
    constants,
    fstatSync,
    linkSync,
    lstatSync,
    openSync,
    opendirSync,
    readSync,
    realpathSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const CRASH_REPORT_LIMIT = 512;
export const CRASH_EVIDENCE_LIMIT = 256 * 1024;
const UNAVAILABLE_FILE_ERRORS = new Set(['EACCES', 'ELOOP', 'ENOENT', 'ENOTDIR', 'EPERM', 'ESTALE']);

function unavailableFile(error: unknown): boolean {
    return isRecord(error) && typeof error.code === 'string' && UNAVAILABLE_FILE_ERRORS.has(error.code);
}

export function crashEvidenceDirectory(): string | undefined {
    const { SOURDAW_BROWSER_AI_CRASH_DIRECTORY: directory, RUNNER_TEMP: runnerTemp } = process.env;
    if (!directory || !runnerTemp || !/^sourdaw-webgpu\.[\da-zA-Z]{8}$/.test(basename(directory))) {
        return undefined;
    }
    try {
        const stat = lstatSync(directory);
        const valid =
            stat.isDirectory() &&
            stat.uid === process.getuid?.() &&
            (stat.mode & 0o7777) === 0o700 &&
            dirname(directory) === realpathSync(runnerTemp) &&
            realpathSync(directory) === directory;
        return valid ? directory : undefined;
    } catch (error) {
        if (unavailableFile(error)) {
            return undefined;
        }
        throw error;
    }
}

export function userCrashReportsDirectory(): string {
    return join(realpathSync(userInfo().homedir), 'Library', 'Logs', 'DiagnosticReports');
}

export function crashReportNames(directory: string): string[] {
    try {
        if (realpathSync(directory) !== directory) {
            throw new Error('DiagnosticReports directory must be canonical');
        }
    } catch (error) {
        if (isRecord(error) && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const entries = opendirSync(directory);
    try {
        const names: string[] = [];
        for (let count = 0; count <= CRASH_REPORT_LIMIT; count++) {
            const entry = entries.readSync();
            if (entry === null) {
                return names;
            }
            if (count === CRASH_REPORT_LIMIT) {
                break;
            }
            // Include preexisting symlinks and non-regular entries in the census.
            if (entry.name.endsWith('.ips')) {
                names.push(entry.name);
            }
        }
        throw new Error('DiagnosticReports directory exceeds scan limit');
    } finally {
        entries.closeSync();
    }
}

export function writeCrashJson(directory: string, name: string, value: object): void {
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
    try {
        // Publish the complete file without overwriting evidence from another launch.
        linkSync(temporary, join(directory, name));
    } finally {
        unlinkSync(temporary);
    }
}

export function readBoundedCrashFile(path: string, limit: number, privateFile = false): string | undefined {
    if (!(constants.O_NOFOLLOW > 0) || !(constants.O_NONBLOCK > 0)) {
        return undefined;
    }
    try {
        if (!lstatSync(path).isFile()) {
            return undefined;
        }
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const stat = fstatSync(fd);
            if (
                !stat.isFile() ||
                stat.size === 0 ||
                stat.size > limit ||
                (privateFile && ((stat.mode & 0o7777) !== 0o600 || stat.uid !== process.getuid?.()))
            ) {
                return undefined;
            }
            const bytes = Buffer.alloc(stat.size + 1);
            let read = 0;
            while (read < bytes.length) {
                const count = readSync(fd, bytes, read, bytes.length - read, null);
                if (count === 0) {
                    break;
                }
                read += count;
            }
            return read === stat.size ? bytes.toString('utf8', 0, read) : undefined;
        } finally {
            closeSync(fd);
        }
    } catch (error) {
        if (unavailableFile(error)) {
            return undefined;
        }
        throw error;
    }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type CrashEvidenceStatus = 'recorded' | 'unavailable';
type CrashEvidence = {
    start: (pid: number, launchBefore: number, launchAfter: number) => CrashEvidenceStatus;
    exit: (code: number | null, signal: NodeJS.Signals | null, planned: boolean) => CrashEvidenceStatus;
};

export function prepareCrashEvidence(
    command: string,
    reportsDirectory?: string
): CrashEvidence | 'unavailable' | undefined {
    if (!process.env.SOURDAW_BROWSER_AI_CRASH_DIRECTORY) {
        return undefined;
    }
    try {
        const directory = crashEvidenceDirectory();
        if (!directory) {
            return 'unavailable';
        }
        const reportNames = crashReportNames(reportsDirectory ?? userCrashReportsDirectory());
        const executable = realpathSync(command);
        const runId = randomUUID();
        let childPid: number | undefined;
        return {
            start(pid, launchBefore, launchAfter) {
                try {
                    writeCrashJson(directory, 'start.json', {
                        runId,
                        pid,
                        parentPid: process.pid,
                        executable,
                        launchBefore,
                        launchAfter,
                        reportNames,
                    });
                    childPid = pid;
                    return 'recorded';
                } catch {
                    return 'unavailable';
                }
            },
            exit(code, signal, planned) {
                if (childPid === undefined) {
                    return 'unavailable';
                }
                try {
                    writeCrashJson(directory, 'exit.json', {
                        runId,
                        pid: childPid,
                        exitedAt: Date.now(),
                        code,
                        signal,
                        planned,
                    });
                    return 'recorded';
                } catch {
                    return 'unavailable';
                }
            },
        };
    } catch {
        return 'unavailable';
    }
}
