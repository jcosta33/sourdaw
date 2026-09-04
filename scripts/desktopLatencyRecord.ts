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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
    /** A gauge's first and last reading — see `computeGaugeReadings` for why it is not differenced like `counterDeltas`. */
    gaugeReadings: Record<string, { first: number; last: number }>;
    streamErrors: { drained: EngineEventRecord[]; console: string[] };
    masterLevelDbMax: number | null;
};

export type MachineRecord = {
    /**
     * The checkout's own HEAD at run time — not the sha the measured
     * artefact was built from. Nothing on this machine ties a packaged
     * `.app` back to the commit that produced it, so a checkout that has
     * since moved on (or a binary copied in from elsewhere) makes this
     * value describe the wrong thing if read as the build's sha. `app.
     * payloadSha256` on the record is the artefact's own identity; this
     * field is the operator checkout's.
     */
    checkoutGitSha: string;
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

/**
 * `'isolated'` is the only value today: the driver always launches against a
 * fresh, temporary `--user-data-dir` rather than the operator's own Electron
 * profile, which can carry a project persisted by an earlier build and
 * refuse every project mutation the driver performs. Kept as a union of one
 * so a future profile mode that deliberately reuses a persisted profile has
 * somewhere to add its own tag rather than overloading this one.
 */
export type AppProfile = 'isolated';

/** One `console` (warning/error) or `pageerror` observation, timestamped and attributed to the step running when it fired. */
export type DiagnosticsEntry = { at: string; step: string; text: string };

export type DiagnosticsRecord = {
    pageErrors: DiagnosticsEntry[];
    consoleWarningsAndErrors: DiagnosticsEntry[];
};

export type DesktopLatencyRecord = {
    schemaVersion: 1;
    measuredAt: string;
    machine: MachineRecord;
    app: {
        path: string;
        bundleVersion: string;
        /**
         * SHA-256 folding together `app.asar`, the native addon, and the
         * plugin-scan helper — the measured artefact's own identity, not the
         * checkout's. See {@link readPayloadIdentity} for why `app.asar` alone
         * cannot serve this purpose.
         */
        payloadSha256: string;
        /** The newest mtime among `payloadFiles`, ISO 8601 — read alongside `payloadSha256` so a rebuilt-but-identical payload is still visible as a different one. */
        payloadMtime: string;
        /** The files folded into `payloadSha256`, relative to `path`, in the fixed sorted order they were hashed. */
        payloadFiles: string[];
        browser: string;
        userAgent: string;
        startedAt: AppStartedAt;
        profile: AppProfile;
    };
    plugin: { path: string };
    legs: LegRecord[];
    diagnostics: DiagnosticsRecord;
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
        checkoutGitSha: git(['rev-parse', 'HEAD']),
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

/** One file folded into a payload identity, with its own bytes already read. */
export type PayloadComponent = { readonly path: string; readonly bytes: Buffer };

export type PayloadIdentity = { sha256: string; mtime: string; files: string[] };

/**
 * Digests a fixed list of components as one identity. Each component's own
 * path is folded into the hash ahead of its bytes — with a NUL separator, so
 * no path/bytes split can collide with another — meaning a byte-identical
 * file at a different path digests differently. The list is sorted by path
 * before hashing, so the caller's own argument order never changes the
 * result.
 *
 * Pure: takes every byte as an argument rather than reading any file itself,
 * which is what lets a spec exercise it without a packaged app on disk.
 */
export function digestPayloadComponents(components: readonly PayloadComponent[]): string {
    const hash = createHash('sha256');
    const sorted = [...components].sort((a, b) => a.path.localeCompare(b.path));
    for (const component of sorted) {
        hash.update(component.path);
        hash.update('\0');
        hash.update(component.bytes);
    }
    return hash.digest('hex');
}

/**
 * The native addon's and plugin-scan helper's packaged file names — the same
 * convention `resolveNativeAddonPath`/`resolveScanHelperPath` in
 * `electron/native.ts` resolve to when `isPackaged`, reimplemented here
 * rather than imported so this script does not compile through the Electron
 * shell's own tsconfig (see `scripts/buildNativeAddon.ts`, which reimplements
 * the same file names for the same reason).
 */
const NATIVE_ADDON_FILE = 'sourdaw-native.node';
const SCAN_HELPER_FILE = (platform: NodeJS.Platform): string =>
    platform === 'win32' ? 'sourdaw-plugin-scan-helper.exe' : 'sourdaw-plugin-scan-helper';

/**
 * The files a run actually loads and can sound through, relative to the app
 * bundle, in the fixed sorted order `readPayloadIdentity` hashes them in.
 * `electron-builder.yml`'s `extraResources` filter carries the native addon
 * and the plugin-scan helper unpacked into `Resources` beside `app.asar`; a
 * native-only rebuild — exactly what the #3070 cutover is — packs a
 * byte-identical `app.asar`, so these two are what actually changes.
 */
function payloadRelativePaths(platform: NodeJS.Platform): string[] {
    return [
        'Contents/Resources/app.asar',
        `Contents/Resources/${NATIVE_ADDON_FILE}`,
        `Contents/Resources/${SCAN_HELPER_FILE(platform)}`,
    ].sort();
}

/**
 * The measured artefact's own identity: a digest folding in every file the
 * run loads, not just the renderer bundle inside `app.asar`. `MachineRecord.
 * checkoutGitSha` cannot serve that purpose because nothing ties a
 * checkout's HEAD to whatever binary actually sits at `--app`; hashing
 * `app.asar` alone cannot either, because a native-only rebuild packs a
 * byte-identical `app.asar` while the addon and the scan helper it ships
 * beside it change — either would silently make two different builds report
 * the same identity.
 */
export function readPayloadIdentity(appPath: string, platform: NodeJS.Platform): PayloadIdentity {
    const relativePaths = payloadRelativePaths(platform);
    const components: PayloadComponent[] = [];
    let newestMtimeMs = 0;
    for (const relativePath of relativePaths) {
        const absolute = resolve(appPath, relativePath);
        if (!existsSync(absolute)) {
            throw new Error(`there is no ${relativePath} at ${absolute}. Run \`pnpm desktop:build\`.`);
        }
        components.push({ path: relativePath, bytes: readFileSync(absolute) });
        newestMtimeMs = Math.max(newestMtimeMs, statSync(absolute).mtimeMs);
    }
    return {
        sha256: digestPayloadComponents(components),
        mtime: new Date(newestMtimeMs).toISOString(),
        files: relativePaths,
    };
}

export type BuildRecordInput = {
    machine: MachineRecord;
    appPath: string;
    payload: PayloadIdentity;
    browser: string;
    userAgent: string;
    startedAt: AppStartedAt;
    pluginPath: string;
    legs: LegRecord[];
    diagnostics: DiagnosticsRecord;
    verdict: Verdict;
    reason: string;
};

/** Assembles the record `writeRecord` writes out. Pure — takes every reading as an argument rather than gathering any of its own. */
export function buildRecord(input: BuildRecordInput): DesktopLatencyRecord {
    return {
        schemaVersion: 1,
        measuredAt: new Date().toISOString(),
        machine: input.machine,
        app: {
            path: input.appPath,
            bundleVersion: readBundleVersion(input.appPath),
            payloadSha256: input.payload.sha256,
            payloadMtime: input.payload.mtime,
            payloadFiles: input.payload.files,
            browser: input.browser,
            userAgent: input.userAgent,
            startedAt: input.startedAt,
            profile: 'isolated',
        },
        plugin: { path: input.pluginPath },
        legs: input.legs,
        diagnostics: input.diagnostics,
        verdict: input.verdict,
        reason: input.reason,
    };
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

function describeGaugeReadings(readings: Record<string, { first: number; last: number }>): string {
    const entries = Object.entries(readings);
    return entries.length === 0
        ? 'none'
        : entries.map(([name, { first, last }]) => `${name} ${String(first)} → ${String(last)}`).join(', ');
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
        ['native gauge readings (first → last)', describeGaugeReadings(leg.gaugeReadings)],
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

/**
 * Generic over the record shape so every driver's baseline — desktop latency,
 * transport clock, and any later addition — shares one writer, the same
 * `jsonSafe` non-finite replacer, and the same printed confirmation line,
 * rather than each driver growing its own copy of `mkdirSync`/`writeFileSync`.
 */
export function writeRecord<TRecord extends object>(jsonPath: string, record: TRecord): void {
    mkdirSync(dirname(resolve(jsonPath)), { recursive: true });
    writeFileSync(resolve(jsonPath), `${JSON.stringify(record, jsonSafe, 4)}\n`);
    process.stdout.write(`\nrecord written to ${jsonPath}\n`);
}
