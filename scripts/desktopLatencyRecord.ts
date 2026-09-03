/**
 * The shape `pnpm desktop:measure` records, its machine provenance, and how it
 * is printed and written.
 *
 * Split from the driver in `scripts/measureDesktopLatency.ts` so that what a
 * baseline record *contains* can be read without reading how the packaged app
 * is launched and driven. A record outlives the run that produced it, and a
 * later cutover comparison reads this file to know what it is comparing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, loadavg, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';

import { type Verdict } from './desktopLatencyReadings.ts';

export type EngineEventRecord = {
    type: string;
    side: string;
    kind: string;
};

export type SampleRecord = {
    /** Milliseconds since this leg started. */
    t: number;
    sampleRateText: string;
    latencyMs: number;
    latencyTitle: string;
    engineState: string;
    missedRenderDeadlines: { count: number; ms: number } | null;
    engineDetectedDropouts: number | null;
    masterLevelText: string;
    masterLevelDb: number | null;
    diagnostics: { running: boolean; counters: Record<string, number> };
};

export type LegRecord = {
    name: string;
    seconds: number;
    load: string;
    samples: SampleRecord[];
    counterDeltas: Record<string, number>;
    streamErrors: { drained: EngineEventRecord[]; console: string[] };
    masterLevelDbMax: number | null;
};

export type MachineRecord = {
    gitSha: string;
    workingTree: 'clean' | 'dirty';
    host: { platform: string; release: string; arch: string; cores: number };
    loadAverage1m: number;
};

/**
 * Which branch of `driveToPlayingProject` ran. The packaged app sometimes opens
 * straight into a restored workspace rather than the launch screen, and a
 * baseline that silently assumed one or the other would misreport which UI
 * path it actually drove.
 */
export type AppStartedAt = 'workspace' | 'launch-screen';

export type DesktopLatencyRecord = {
    schemaVersion: 1;
    measuredAt: string;
    machine: MachineRecord;
    app: { path: string; bundleVersion: string; browser: string; userAgent: string; startedAt: AppStartedAt };
    plugin: { path: string };
    legs: LegRecord[];
    verdict: Verdict;
    reason: string;
};

/** A number without its machine is not a measurement. */
export function machineProvenance(): MachineRecord {
    const git = (args: readonly string[]): string => {
        try {
            return execFileSync('git', [...args], { encoding: 'utf8' }).trim();
        } catch {
            return 'unavailable';
        }
    };
    return {
        gitSha: git(['rev-parse', 'HEAD']),
        workingTree: git(['status', '--porcelain']) === '' ? 'clean' : 'dirty',
        host: { platform: platform(), release: release(), arch: arch(), cores: cpus().length },
        loadAverage1m: Number((loadavg()[0] ?? 0).toFixed(2)),
    };
}

export function readBundleVersion(appPath: string): string {
    const plist = resolve(appPath, 'Contents/Info.plist');
    if (!existsSync(plist)) {
        return 'unavailable';
    }
    const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(
        readFileSync(plist, 'utf8')
    );
    return match?.[1] ?? 'unavailable';
}

function formatDb(value: number | null): string {
    if (value === null) {
        return 'n/a';
    }
    return Number.isFinite(value) ? `${value.toFixed(1)} dB` : '-∞ dB';
}

function formatMissed(sample: SampleRecord | undefined): string {
    if (sample === undefined || sample.missedRenderDeadlines === null) {
        return 'unavailable';
    }
    return `${String(sample.missedRenderDeadlines.count)} (${sample.missedRenderDeadlines.ms.toFixed(1)} ms)`;
}

function describeCounterDeltas(deltas: Record<string, number>): string {
    const moved = Object.entries(deltas).filter(([, delta]) => delta !== 0);
    return moved.length === 0
        ? 'every counter unmoved'
        : moved.map(([name, delta]) => `${name} ${delta > 0 ? '+' : ''}${String(delta)}`).join(', ');
}

export function reportLeg(leg: LegRecord): void {
    const last = leg.samples[leg.samples.length - 1];
    const latencies = leg.samples.map((entry) => entry.latencyMs);
    const dropouts = last?.engineDetectedDropouts;

    const rows: [string, string][] = [
        ['samples', `${String(leg.samples.length)} over ${String(leg.seconds)} s`],
        ['device rate', last?.sampleRateText ?? 'unknown'],
        ['output latency', `${Math.min(...latencies).toFixed(1)}–${Math.max(...latencies).toFixed(1)} ms`],
        ['latency breakdown', last?.latencyTitle ?? 'unknown'],
        ['engine state', last?.engineState ?? 'unknown'],
        ['missed render deadlines', formatMissed(last)],
        ['engine-detected dropouts', dropouts === undefined || dropouts === null ? 'unavailable' : String(dropouts)],
        ['master level', `max ${formatDb(leg.masterLevelDbMax)}, last ${formatDb(last?.masterLevelDb ?? null)}`],
        ['native engine running', last?.diagnostics.running === true ? 'yes' : 'no'],
        ['native counter deltas', describeCounterDeltas(leg.counterDeltas)],
        [
            'stream errors',
            `${String(leg.streamErrors.drained.length)} drained here, ${String(leg.streamErrors.console.length)} on the console`,
        ],
    ];

    process.stdout.write(`\n  ${leg.name.toUpperCase()} — ${leg.load}\n`);
    for (const [label, value] of rows) {
        process.stdout.write(`    ${label.padEnd(25)} ${value}\n`);
    }
    for (const event of leg.streamErrors.drained) {
        process.stdout.write(`      drained: ${event.type} on the ${event.side} stream: ${event.kind}\n`);
    }
    for (const line of leg.streamErrors.console) {
        process.stdout.write(`      console: ${line}\n`);
    }
}

/**
 * JSON has no `Infinity`, and `-∞ dB` is a real reading: left alone,
 * `JSON.stringify` writes it as `null` and it becomes indistinguishable from
 * `n/a`, which means the opposite — no meter tap rather than silence.
 */
function jsonSafe(_key: string, value: unknown): unknown {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return String(value);
    }
    return value;
}

export function writeRecord(jsonPath: string, record: DesktopLatencyRecord): void {
    mkdirSync(dirname(resolve(jsonPath)), { recursive: true });
    writeFileSync(resolve(jsonPath), `${JSON.stringify(record, jsonSafe, 4)}\n`);
    process.stdout.write(`\nrecord written to ${jsonPath}\n`);
}
