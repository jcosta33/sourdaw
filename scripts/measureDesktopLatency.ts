#!/usr/bin/env node

/**
 * What does a musician actually see in the packaged desktop app's own status
 * bar while a plugin is sounding, and what does the native engine report
 * underneath it?
 *
 * This is the pre-cutover baseline instrument for #3070. Before the native
 * audio path takes over playback, the numbers the app itself publishes have to
 * exist as a recorded figure taken on a real machine from a real packaged
 * build. Otherwise "the cutover improved latency" is a claim with nothing on
 * the other side of the comparison, and a dropout the cutover introduced is
 * indistinguishable from one that was always there.
 *
 * It measures the shipped artefact, not a paraphrase of it: the
 * `electron-builder` output, launched as the user launches it, driven over the
 * Chrome DevTools Protocol through the product's own UI — launch screen,
 * browser panel, plugin scan, plugin load, transport play. Every figure comes
 * from the product's own readouts, the status-bar elements written by
 * `useStatusBarMetrics.ts` plus the native `engine_rt_diagnostics` command over
 * the preload bridge. Nothing here recomputes a quantity the app computes,
 * because a harness that recomputes the readout measures the harness.
 *
 * This file is the CLI entry point: argument parsing, preconditions, and
 * orchestrating the phases that live in the sibling `desktopLatency*.ts`
 * modules — `desktopLatencyProcess.ts` (spawn, connect, teardown),
 * `desktopLatencyConnect.ts` (drive the UI and take the leg samples) and
 * `desktopLatencyRecord.ts` (the record's own shape and provenance).
 *
 * Launch and preconditions
 * ------------------------
 * The app is launched against a fresh, temporary `--user-data-dir` rather than
 * the operator's own Electron profile: a shared profile can hold a project
 * persisted by an earlier build, and every project mutation this harness
 * performs — adding a track, loading a plugin — is refused against a project
 * already on disk. A fresh profile always lands on the launch screen; how
 * `driveToPlayingProject` in `desktopLatencyConnect.ts` gets from there to a
 * playing project, past the alpha notice and the onboarding tour, is
 * documented there.
 *
 * Why jsdom and Vitest cannot answer any of this
 * ----------------------------------------------
 * The quantities are properties of the shipped runtime, not of our source.
 * `baseLatency` and `outputLatency` are the packaged Chromium's numbers for
 * this machine's audio device and exist in no simulated DOM. The master peak
 * level only becomes non-silent when a real CLAP binary is scanned, `dlopen`ed,
 * instantiated and rendered by the real host — a mocked scanner proves nothing
 * about whether plugin audio reaches the meter. The native counters come from a
 * Rust ring buffer inside the packaged binary, which no unit test has.
 *
 * What each leg establishes
 * -------------------------
 * IDLE — the control. Playback running, nothing else touching the main thread.
 *   A figure taken only under load cannot be told apart from a contended box;
 *   IDLE is what makes the loaded leg legible.
 *
 * UI-LOAD — the same measurement with the main thread deliberately busy, which
 *   is the state a DAW main thread is actually in during playback: timeline
 *   redraw and meter updates every frame. The generator lives in
 *   `desktopLatencyUiLoad.ts`.
 *
 * Dropouts under load are RECORDED, never a failure — pre-cutover
 * --------------------------------------------------------------
 * Before the native cutover the plugin renders through Web Audio and the
 * worklet bridge; the native master carries no plugin audio yet. A bridge
 * counter or a stream error seen here therefore describes the pre-cutover
 * arrangement, which is the thing this record exists to capture, and failing on
 * it would mean the baseline could not be taken at all. The one outcome that
 * *is* a failure is the plugin never reaching the meter, because then the run
 * measured a silent app and every number in it is about nothing.
 *
 *   0  MEASURED     — the run held; the record is the result.
 *   1  FAILED       — the master level never exceeded the audible floor after
 *                     the plugin was loaded. Plugin audio never arrived.
 *   2  NOT MEASURED — a precondition, a UI step, or finishing the record did
 *                     not hold. Nothing was measured and nothing is claimed.
 *                     Every path out of `main()` and every otherwise-uncaught
 *                     exception maps here rather than falling through to
 *                     Node's own default exit 1, which this contract reserves
 *                     for the one designed FAILED verdict above.
 *
 * Usage: `pnpm desktop:measure [--app <path>] [--seconds <n>] [--json <path>]`.
 * A number without its machine is not a measurement, so the record carries the
 * operator checkout's git sha, the measured artefact's own `app.asar` hash,
 * whether the checkout tree was clean, the host, and the packaged app's own
 * Chromium and Electron versions.
 */

import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type MeasuredLegs } from './desktopLatencyConnect.ts';
import { printDiagnostics, emptyDiagnostics } from './desktopLatencyDiagnostics.ts';
import { launchAndMeasure } from './desktopLatencyProcess.ts';
import { decideVerdict, describeAudibleFloor, parseArgs, type DesktopLatencyArgs } from './desktopLatencyReadings.ts';
import {
    buildRecord,
    machineProvenance,
    readAsarIdentity,
    reportLeg,
    writeRecord,
    type AsarIdentity,
} from './desktopLatencyRecord.ts';
import { harnessPluginDestination } from './installHarnessPlugin.ts';

const EXIT_MEASURED = 0;
const EXIT_FAILED = 1;
const EXIT_NOT_MEASURED = 2;

/** A fresh, per-run Electron profile — never the operator's own `~/Library/Application Support/sourdaw`. */
const PROFILE_DIR_PREFIX = 'sourdaw-desktop-measure-';

function notMeasured(reason: string, jsonPath: string | null): number {
    process.stdout.write(`\nNOT MEASURED: ${reason}\n`);
    if (jsonPath !== null) {
        process.stdout.write('no record written — a run that measured nothing has nothing to record\n');
    }
    return EXIT_NOT_MEASURED;
}

async function main(): Promise<number> {
    let args: DesktopLatencyArgs;
    try {
        args = parseArgs(process.argv);
    } catch (error) {
        process.stdout.write(`\nNOT MEASURED: ${error instanceof Error ? error.message : String(error)}\n`);
        return EXIT_NOT_MEASURED;
    }

    const pluginPath = harnessPluginDestination(process.platform, homedir());
    const binary = resolve(args.appPath, 'Contents/MacOS/Sourdaw');

    process.stdout.write('Packaged desktop latency and dropout measurement\n');
    process.stdout.write('===============================================\n');
    const machine = machineProvenance();
    process.stdout.write(
        `host              ${machine.host.platform} ${machine.host.release} ${machine.host.arch}, ${String(machine.host.cores)} logical cores\n`
    );
    process.stdout.write(`load average (1m) ${machine.loadAverage1m.toFixed(2)}\n`);
    process.stdout.write(`checkout          ${machine.checkoutGitSha} (${machine.workingTree})\n`);
    process.stdout.write(`app               ${args.appPath}\n`);

    if (!existsSync(binary)) {
        return notMeasured(`there is no packaged app binary at ${binary}. Run \`pnpm desktop:build\`.`, args.jsonPath);
    }
    if (!existsSync(pluginPath)) {
        return notMeasured(
            `the harness plugin is not installed at ${pluginPath}. Run \`pnpm harness:plugin:install\`.`,
            args.jsonPath
        );
    }
    let asar: AsarIdentity;
    try {
        asar = readAsarIdentity(args.appPath);
    } catch (error) {
        return notMeasured(error instanceof Error ? error.message : String(error), args.jsonPath);
    }
    process.stdout.write(`app.asar          sha256:${asar.sha256} mtime:${asar.mtime}\n`);

    // Never the operator's own `~/Library/Application Support/sourdaw`: that
    // profile can carry a project persisted by an earlier build, on which the
    // driver's own project mutations (adding a track, loading a plugin) are
    // refused.
    const profileDir = mkdtempSync(join(tmpdir(), PROFILE_DIR_PREFIX));
    process.stdout.write(`profile           isolated (${profileDir})\n`);
    process.stdout.write(`plugin            ${pluginPath}\n`);
    process.stdout.write(`legs              idle and ui-load, ${String(args.seconds)} s each\n`);

    const diagnostics = emptyDiagnostics();
    let measured: MeasuredLegs;
    try {
        measured = await launchAndMeasure(binary, profileDir, args.seconds, pluginPath, diagnostics);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return notMeasured(reason, args.jsonPath);
    }

    process.stdout.write(`started at        ${measured.startedAt}\n`);
    for (const leg of measured.legs) {
        reportLeg(leg);
    }
    printDiagnostics(diagnostics);

    const verdict = decideVerdict(measured.legs);
    const reason =
        verdict === 'measured'
            ? 'the plugin reached the master meter and both legs completed'
            : `the master level never exceeded ${describeAudibleFloor()} after the plugin was loaded`;

    process.stdout.write(`\nVERDICT ${verdict.toUpperCase()} — ${reason}\n`);
    process.stdout.write(
        'Dropouts and stream errors above are recorded, not failed: pre-cutover the plugin renders through Web Audio\n' +
            'and the worklet bridge, and the native master carries no plugin audio yet.\n'
    );

    if (verdict !== 'measured') {
        if (args.jsonPath !== null) {
            process.stdout.write('\nno record written — a failed run is not a baseline\n');
        }
        return EXIT_FAILED;
    }

    // From here on the run has already earned its MEASURED verdict; what is
    // left is naming the artefact and writing the record out. A failure in
    // this region — an unwritable `--json` path (`EACCES`, `ENOTDIR`) — must
    // not be reported as the audible-floor FAILED verdict this run never
    // earned. It is its own NOT MEASURED, named by its own reason, rather
    // than an uncaught exception that would otherwise reach the top-level
    // `main()` call as a bare exit 1.
    try {
        const record = buildRecord({
            machine,
            appPath: args.appPath,
            asar,
            browser: measured.version.browser,
            userAgent: measured.version.userAgent,
            startedAt: measured.startedAt,
            pluginPath,
            legs: measured.legs,
            diagnostics,
            verdict,
            reason,
        });

        if (args.jsonPath !== null) {
            writeRecord(args.jsonPath, record);
        }
        return EXIT_MEASURED;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return notMeasured(
            `the run measured the plugin but the record could not be finished: ${message}`,
            args.jsonPath
        );
    }
}

// The pure helpers this file delegates to are unit-tested, so importing this
// file must not launch a packaged app. `realpathSync`, because the ESM loader
// realpaths `import.meta.url` while `argv[1]` keeps any symlink — see
// `scripts/installHarnessPlugin.ts`, which carries the same guard.
const invokedPath = process.argv[1] === undefined ? '' : realpathSync(resolve(process.argv[1]));
if (invokedPath === fileURLToPath(import.meta.url)) {
    // Defense in depth on top of `main()`'s own internal NOT MEASURED
    // mapping: this script's own contract reserves exit 1 for the one
    // designed FAILED verdict (the plugin never reached the master meter).
    // An uncaught exception has no verdict of its own, and Node's default
    // handling for one is also exit 1 — indistinguishable from that FAILED
    // verdict unless every throw `main()` does not already catch is mapped
    // here instead.
    try {
        process.exitCode = await main();
    } catch (error) {
        process.stdout.write(`\nNOT MEASURED: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = EXIT_NOT_MEASURED;
    }
}
