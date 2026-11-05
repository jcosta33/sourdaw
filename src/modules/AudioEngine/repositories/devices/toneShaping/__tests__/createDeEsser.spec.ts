import { execFile } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';
import { beforeAll, describe, expect, it, type TestContext } from 'vitest';

import { dbToGain, gainToDb } from '#/utils/audioLevelLaw';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyDeEsserParams } from '../applyDeEsserParams';
import { DEFAULT_DEESSER_RANGE_DB, createDeEsser } from '../createDeEsser';

type DeEsserNode = ReturnType<typeof createDeEsser>;

function gainOf(device: DeEsserNode, name: string): GainNode {
    const node = device.namedNodes?.[name];
    if (!node) {
        throw new Error(`expected a named ${name} node`);
    }
    return node as GainNode;
}

function connectionsOf(node: AudioNode): unknown[] {
    return (node as unknown as { connectedTo: unknown[] }).connectedTo;
}

function expectConnections(from: AudioNode, to: AudioNode | AudioParam): void {
    expect(connectionsOf(from)).toContain(to);
}

describe('createDeEsser split-band graph (#3735)', () => {
    it('drives reduction from the selected band only, never the broadband input', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const bandpass = device.namedNodes?.bandpass as BiquadFilterNode;
        const absShaper = device.namedNodes?.absShaper as WaveShaperNode;
        const input = device.namedNodes?.input as AudioNode;
        expect(bandpass.type).toBe('bandpass');
        // The detector chain is input → bandpass → rectifier: whatever the
        // reduction law reacts to has passed through the band selection first.
        expectConnections(input, bandpass);
        expectConnections(bandpass, absShaper);
        // And no wire from input to the rectifier: broadband audio cannot
        // drive the sibilant reduction.
        expect(connectionsOf(input)).not.toContain(absShaper);
    });

    it('cancels the raw band against the wet band with equal, opposite reduction weights', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const wet = gainOf(device, 'wet');
        const cancel = gainOf(device, 'cancel');
        const defaultReductionWeight = 1 - dbToGain(DEFAULT_DEESSER_RANGE_DB);
        expect(wet.gain.value).toBeCloseTo(defaultReductionWeight, 12);
        expect(cancel.gain.value).toBeCloseTo(-defaultReductionWeight, 12);
        // Idle control → wet and cancel carry the same band and sum to
        // nothing; the device is unity until the band actually compresses.
        expect(wet.gain.value + cancel.gain.value).toBeCloseTo(0, 12);
    });

    it('modulates only the band control gain, from the band envelope, at intrinsic unity', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const bandpass = device.namedNodes?.bandpass as AudioNode;
        const wet = gainOf(device, 'wet');
        const cancel = gainOf(device, 'cancel');
        const controlGain = gainOf(device, 'controlGain');
        const absShaper = device.namedNodes?.absShaper as AudioNode;
        const envFilter = device.namedNodes?.envFilter as AudioNode;
        const envSum = device.namedNodes?.envSum as AudioNode;
        const kneeShaper = device.namedNodes?.kneeShaper as AudioNode;
        const threshLin = device.namedNodes?.threshLin as ConstantSourceNode;
        // The band's series element sits between the bandpass and the Range
        // weight, at intrinsic unity, so below threshold the wet tap is an
        // exact w·x copy of the cancel tap's −w·x.
        expectConnections(bandpass, controlGain);
        expectConnections(controlGain, wet);
        expect(controlGain.gain.value).toBe(1);
        // The control chain feeds the control gain's AudioParam; the cancel
        // tap stays raw so the two sum against each other exactly.
        expectConnections(absShaper, envFilter);
        expectConnections(envFilter, envSum);
        expectConnections(threshLin, envSum);
        expectConnections(envSum, kneeShaper);
        expectConnections(kneeShaper, controlGain.gain);
        expect(connectionsOf(kneeShaper)).not.toContain(cancel);
        // The threshold enters as a negated linear gain to subtract.
        expect(threshLin.offset.value).toBeCloseTo(-dbToGain(-20), 12);
    });

    it('builds control curves whose below-threshold branch is exactly zero', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const kneeShaper = device.namedNodes?.kneeShaper as WaveShaperNode;
        const absShaper = device.namedNodes?.absShaper as WaveShaperNode;
        const knee = kneeShaper.curve!;
        // Odd length: x = 0 is a curve sample, not an interpolation.
        expect(knee.length % 2).toBe(1);
        // Every input at or below zero (envelope at or under threshold) maps
        // to exactly 0.0 — the unity branch the idle-is-unity contract rides
        // on — and every positive input reduces, never boosts.
        for (let index = 0; index <= Math.floor(knee.length / 2); index++) {
            expect(knee[index]).toBe(0);
        }
        for (let index = Math.floor(knee.length / 2) + 1; index < knee.length; index++) {
            expect(knee[index]).toBeLessThan(0);
            expect(knee[index]).toBeGreaterThanOrEqual(-1);
        }
        // The rectifier before it is |x|: the envelope is the band's level.
        expect(absShaper.curve![0]).toBe(1);
        expect(absShaper.curve![absShaper.curve!.length - 1]).toBe(1);
        expect(absShaper.curve![Math.floor(absShaper.curve!.length / 2)]).toBe(0);
    });

    it('sums the full-range path, the band taps and the listen tap at one output', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const output = device.namedNodes?.output as AudioNode;
        const inputGain = gainOf(device, 'inputGain');
        const wet = gainOf(device, 'wet');
        const cancel = gainOf(device, 'cancel');
        const listen = gainOf(device, 'listen');
        expectConnections(inputGain, output);
        expectConnections(wet, output);
        expectConnections(cancel, output);
        expectConnections(listen, output);
    });
});

describe('applyDeEsserParams (#3735)', () => {
    it('moves the detector band with deess-freq and the threshold with deess-threshold', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const bandpass = device.namedNodes?.bandpass as BiquadFilterNode;
        const threshLin = device.namedNodes?.threshLin as ConstantSourceNode;
        applyDeEsserParams(device, { 'deess-freq': 8000, 'deess-threshold': -30 });
        expect(bandpass.frequency.value).toBe(8000);
        // The threshold knob is stored as the negated linear subtractor.
        expect(threshLin.offset.value).toBeCloseTo(-dbToGain(-30), 12);
    });

    it('converts deess-range into the 1 − 10^(range/20) band-tap weight the limit law needs', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const wet = gainOf(device, 'wet');
        const cancel = gainOf(device, 'cancel');
        applyDeEsserParams(device, { 'deess-range': -6 });
        // The output subtracts the tap weight from unity, so full engagement
        // lands on gain 10^(range/20): attenuated by exactly −range dB — the
        // declared limit — and never more, whatever the control curve does.
        const reductionWeight = 1 - dbToGain(-6);
        expect(wet.gain.value).toBeCloseTo(reductionWeight, 12);
        expect(cancel.gain.value).toBeCloseTo(-reductionWeight, 12);
        expect(gainToDb(1 - Math.abs(wet.gain.value))).toBeCloseTo(-6, 9);
    });

    it('isolates the selected band while Listen is on and restores the path after', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const listen = gainOf(device, 'listen');
        const inputGain = gainOf(device, 'inputGain');
        applyDeEsserParams(device, { 'deess-listen': 1 });
        expect(listen.gain.value).toBe(1);
        expect(inputGain.gain.value).toBe(0);
        applyDeEsserParams(device, { 'deess-listen': 0 });
        expect(listen.gain.value).toBe(0);
        expect(inputGain.gain.value).toBe(1);
    });

    it('leaves values untouched when params object is empty', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const bandpass = device.namedNodes?.bandpass as BiquadFilterNode;
        applyDeEsserParams(device, {});
        expect(bandpass.frequency.value).toBe(6000);
    });
});

// ── Real OfflineAudioContext renders ─────────────────────────────────────
//
// The review pinned the idle-is-unity contract to a render, not a mock:
// the previous topology's defect (the platform compressor's look-ahead and
// makeup gain) was invisible to every `connectedTo` assertion. These specs
// bundle the production factory source with esbuild and execute it in a real
// Chromium page, so the samples come from the platform's own render graph.

const SAMPLE_RATE = 48_000;
const RENDER_SECONDS = 0.5;
const FRAMES = RENDER_SECONDS * SAMPLE_RATE;
/**
 * Band-centred-ish tone (6 kHz band, Q 2) whose look-ahead window is 37.8
 * periods: deliberately phase-incoherent with any fixed compensation delay,
 * so a misaligned summation shows up large instead of cancelling by chance.
 */
const TONE_HZ = 6_300;
/**
 * The detector band's own centre: the band tap meets this tone at the
 * bandpass's unity point, so the Range pins read the reduction law directly.
 */
const CENTER_TONE_HZ = 6_000;
/** −26 dBFS peak: 6 dB under the −20 dB threshold, so no reduction triggers. */
const IDLE_AMPLITUDE = 0.05;
/** ≈ −0.9 dBFS peak: deep into the reduction law. */
const HOT_AMPLITUDE = 0.9;
const SETTLE_FRAMES = Math.floor(0.25 * SAMPLE_RATE);
/** The demanded idle tolerance. */
const UNITY_TOLERANCE = 1e-3;

type RenderPaths = { input: AudioNode; output: AudioNode };

type PageDeEsserFactory = {
    createDeEsser: (ctx: BaseAudioContext) => { inputNode: AudioNode; outputNode: AudioNode };
    applyDeEsserParams: (device: object, params: Record<string, number>) => void;
};

type RenderResult = { device: number[]; control: number[] };

type RangeRenderResult = { control: number[]; band: number[]; device: number[] };

type ComplexBin = { real: number; imaginary: number };

type LaunchAttempt = 'bundled' | 'channel:chrome';

/** What the warm-up needs from a page; Playwright's `Page` satisfies it. */
type WarmupPage = {
    goto(url: string): Promise<unknown>;
    addScriptTag(script: { content: string }): Promise<unknown>;
};

/** What the warm-up needs from a browser; Playwright's `Browser` satisfies it. */
type WarmupBrowser<P extends WarmupPage> = {
    version(): string;
    newPage(): Promise<P>;
};

type ChildCommand = { file: string; args: string[] };

/**
 * Each step's own bound. Together they stay under the 120s hook budget even
 * when both launch attempts run, so a stalled step fails under its own name
 * rather than as an anonymous hook timeout.
 */
type WarmupDeadlines = {
    launch: number;
    newPage: number;
    bundle: number;
    goto: number;
    addScriptTag: number;
};

type WarmupSteps<P extends WarmupPage> = {
    launch: (attempt: LaunchAttempt) => Promise<WarmupBrowser<P>>;
    bundleCommand: ChildCommand;
    deadlines: WarmupDeadlines;
};

type RenderSetup<P extends WarmupPage> =
    | { kind: 'ready'; page: P; browser: { version: string; launch: LaunchAttempt } }
    | { kind: 'absent'; reason: string };

const WARMUP_DEADLINES: WarmupDeadlines = {
    launch: 40_000,
    newPage: 10_000,
    bundle: 15_000,
    goto: 5_000,
    addScriptTag: 5_000,
};

/** Playwright's own wording for a browser that is not installed here. */
const BROWSER_ABSENT = /Executable doesn't exist at|Chromium distribution 'chrome' is not found/;

let pagePromise: Promise<Page | null> | null = null;
let launchFailure: string | null = null;
let renderBrowser: { version: string; launch: LaunchAttempt } | null = null;

function warmupStepError(step: string, detail: string): Error {
    return new Error(`de-esser render warm-up step "${step}" ${detail}`);
}

function withinDeadline<T>(step: string, deadlineMs: number, work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(warmupStepError(step, `did not settle within ${deadlineMs} ms`));
        }, deadlineMs);
    });
    return Promise.race([work, expiry]).finally(() => {
        clearTimeout(timer);
    });
}

/**
 * Run a child asynchronously so its stall cannot block the worker's timers,
 * and kill it when its deadline passes. The callback fires only once the
 * child has exited, so a rejection means it is gone.
 */
function runChildWithinDeadline(step: string, command: ChildCommand, deadlineMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            command.file,
            command.args,
            // The child resolves its bare `esbuild` import from the cwd.
            { cwd: process.cwd(), encoding: 'utf8', timeout: deadlineMs, killSignal: 'SIGKILL' },
            (error, stdout) => {
                if (error?.killed) {
                    reject(warmupStepError(step, `did not settle within ${deadlineMs} ms and was killed`));
                    return;
                }
                if (error) {
                    reject(warmupStepError(step, `failed: ${error.message}`));
                    return;
                }
                resolve(stdout);
            }
        );
    });
}

function isBrowserAbsent(error: unknown): boolean {
    return error instanceof Error && BROWSER_ABSENT.test(error.message);
}

/**
 * The bundled Playwright browser, falling back to a system Chrome only when
 * the bundled one is not installed. `null` carries the reason neither is
 * installed; any other launch failure, a stall included, fails by name.
 */
async function launchRenderBrowser<P extends WarmupPage>(
    steps: WarmupSteps<P>
): Promise<{ browser: WarmupBrowser<P>; launch: LaunchAttempt } | { absent: string }> {
    let absent = '';
    for (const attempt of ['bundled', 'channel:chrome'] as const) {
        try {
            const browser = await withinDeadline(`launch ${attempt}`, steps.deadlines.launch, steps.launch(attempt));
            return { browser, launch: attempt };
        } catch (error) {
            if (!isBrowserAbsent(error)) {
                throw error;
            }
            absent = error instanceof Error ? error.message : String(error);
        }
    }
    return { absent };
}

/** Launch, open one page, bundle the factory and evaluate it there. */
async function prepareRenderSetup<P extends WarmupPage>(steps: WarmupSteps<P>): Promise<RenderSetup<P>> {
    const launched = await launchRenderBrowser(steps);
    if ('absent' in launched) {
        return { kind: 'absent', reason: launched.absent };
    }
    const { deadlines } = steps;
    const page = await withinDeadline('newPage', deadlines.newPage, launched.browser.newPage());
    const bundled: unknown = JSON.parse(await runChildWithinDeadline('bundle', steps.bundleCommand, deadlines.bundle));
    if (typeof bundled !== 'string') {
        throw warmupStepError('bundle', 'did not print a JSON-encoded script');
    }
    await withinDeadline('goto', deadlines.goto, page.goto('about:blank'));
    await withinDeadline('addScriptTag', deadlines.addScriptTag, page.addScriptTag({ content: bundled }));
    return { kind: 'ready', page, browser: { version: launched.browser.version(), launch: launched.launch } };
}

/**
 * Bundle the production factory and parameter applier with esbuild in a child
 * Node process — in-process esbuild refuses to run under vitest's module
 * transform — whose stdout is the IIFE script exposing both, JSON-encoded.
 * The render therefore executes the real `createDeEsser` and
 * `applyDeEsserParams` sources with the `#/` alias resolved, not a
 * hand-copied graph.
 */
function bundleDeviceSourcesCommand(): ChildCommand {
    // Vitest does not hand spec modules a file:// `import.meta.url`, so paths
    // resolve from the runner's cwd: the repository root (`pnpm test:run`).
    const fromRepositoryRoot = (...segments: string[]): string => resolvePath(process.cwd(), ...segments);
    const toneShapingRoot = ['src', 'modules', 'AudioEngine', 'repositories', 'devices', 'toneShaping'];
    const factoryEntry = fromRepositoryRoot(...toneShapingRoot, 'createDeEsser.ts');
    const paramsEntry = fromRepositoryRoot(...toneShapingRoot, 'applyDeEsserParams.ts');
    const srcRoot = fromRepositoryRoot('src');
    const script = `
        const { build } = await import('esbuild');
        // Under --eval there is no script-name argv slot: the first user
        // argument sits at process.argv[1].
        const [factoryEntry, paramsEntry, aliasRoot] = process.argv.slice(1);
        const bundled = await build({
            stdin: {
                contents:
                    'export { createDeEsser } from ' + JSON.stringify(factoryEntry) + ';\\n' +
                    'export { applyDeEsserParams } from ' + JSON.stringify(paramsEntry) + ';',
                resolveDir: aliasRoot,
                loader: 'ts',
            },
            bundle: true,
            write: false,
            format: 'iife',
            globalName: '__sourdawDeEsser',
            alias: { '#': aliasRoot },
            platform: 'browser',
            logLevel: 'silent',
        });
        process.stdout.write(JSON.stringify(bundled.outputFiles[0].text));
    `;
    return {
        file: process.execPath,
        args: ['--input-type=module', '--eval', script, factoryEntry, paramsEntry, srcRoot],
    };
}

function launchPlaywrightChromium(attempt: LaunchAttempt): Promise<Browser> {
    return attempt === 'bundled' ? chromium.launch() : chromium.launch({ channel: 'chrome' });
}

/**
 * One page per file, prepared once: bundle the factory, evaluate it, and
 * leave the global in place for every render. `null` carries the skip.
 */
function pageOnce(): Promise<Page | null> {
    pagePromise ??= (async () => {
        const setup = await prepareRenderSetup({
            launch: launchPlaywrightChromium,
            bundleCommand: bundleDeviceSourcesCommand(),
            deadlines: WARMUP_DEADLINES,
        });
        if (setup.kind === 'absent') {
            launchFailure = setup.reason;
            return null;
        }
        renderBrowser = setup.browser;
        return setup.page;
    })();
    return pagePromise;
}

async function renderThroughDevice(toneHz: number, amplitude: number, rangeDb?: number): Promise<RenderResult> {
    const page = await pageOnce();
    if (!page) {
        throw new Error(launchFailure ?? 'Chromium page unavailable');
    }
    return page.evaluate(
        async ({ toneHz, amplitude, rangeDb, sampleRate, frames }) => {
            const factory = (globalThis as unknown as { __sourdawDeEsser: PageDeEsserFactory }).__sourdawDeEsser;
            async function renderPath(build: (ctx: BaseAudioContext) => RenderPaths): Promise<number[]> {
                const ctx = new OfflineAudioContext(1, frames, sampleRate);
                const paths = build(ctx);
                const source = ctx.createOscillator();
                source.type = 'sine';
                source.frequency.value = toneHz;
                const level = ctx.createGain();
                level.gain.value = amplitude;
                source.connect(level);
                level.connect(paths.input);
                paths.output.connect(ctx.destination);
                source.start(0);
                const rendered = await ctx.startRendering();
                return Array.from(rendered.getChannelData(0));
            }
            const control = await renderPath((ctx) => {
                const wire = ctx.createGain();
                wire.gain.value = 1;
                return { input: wire, output: wire };
            });
            const device = await renderPath((ctx) => {
                const built = factory.createDeEsser(ctx);
                if (rangeDb !== undefined) {
                    factory.applyDeEsserParams(built, { 'deess-range': rangeDb });
                }
                return { input: built.inputNode, output: built.outputNode };
            });
            return { device, control };
        },
        { toneHz, amplitude, rangeDb, sampleRate: SAMPLE_RATE, frames: FRAMES }
    );
}

/**
 * One render triple for a Range setting: the unity-wire reference, the raw
 * detector band (Listen isolation with the Range taps stilled), and the
 * device itself with that Range applied — all on the band's own centre
 * frequency, so the taps meet the tone at the bandpass's unity point.
 */
async function renderRangeProof(toneHz: number, rangeDb: number): Promise<RangeRenderResult> {
    const page = await pageOnce();
    if (!page) {
        throw new Error(launchFailure ?? 'Chromium page unavailable');
    }
    return page.evaluate(
        async ({ toneHz, amplitude, rangeDb, sampleRate, frames }) => {
            const factory = (globalThis as unknown as { __sourdawDeEsser: PageDeEsserFactory }).__sourdawDeEsser;
            async function renderPath(build: (ctx: BaseAudioContext) => RenderPaths): Promise<number[]> {
                const ctx = new OfflineAudioContext(1, frames, sampleRate);
                const paths = build(ctx);
                const source = ctx.createOscillator();
                source.type = 'sine';
                source.frequency.value = toneHz;
                const level = ctx.createGain();
                level.gain.value = amplitude;
                source.connect(level);
                level.connect(paths.input);
                paths.output.connect(ctx.destination);
                source.start(0);
                const rendered = await ctx.startRendering();
                return Array.from(rendered.getChannelData(0));
            }
            const control = await renderPath((ctx) => {
                const wire = ctx.createGain();
                wire.gain.value = 1;
                return { input: wire, output: wire };
            });
            const band = await renderPath((ctx) => {
                const built = factory.createDeEsser(ctx);
                // Listen isolates the band, but the engaged band taps still sum
                // against it — audibly the *processed* band. Zeroing Range here
                // stills the taps, so this render captures the raw bandpass
                // output the device under test itself subtracts.
                factory.applyDeEsserParams(built, { 'deess-listen': 1, 'deess-range': 0 });
                return { input: built.inputNode, output: built.outputNode };
            });
            const device = await renderPath((ctx) => {
                const built = factory.createDeEsser(ctx);
                factory.applyDeEsserParams(built, { 'deess-range': rangeDb });
                return { input: built.inputNode, output: built.outputNode };
            });
            return { control, band, device };
        },
        { toneHz, amplitude: HOT_AMPLITUDE, rangeDb, sampleRate: SAMPLE_RATE, frames: FRAMES }
    );
}

function maxAbsoluteDifference(a: readonly number[], b: readonly number[]): number {
    let max = 0;
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
        max = Math.max(max, Math.abs(a[index]! - b[index]!));
    }
    return max;
}

/** Single-bin DFT over `[from, to)`; a sine at an exact bin reads its peak. */
function complexBin(signal: readonly number[], frequency: number, from: number, to: number): ComplexBin {
    let real = 0;
    let imaginary = 0;
    for (let index = from; index < to; index++) {
        const angle = (2 * Math.PI * frequency * index) / SAMPLE_RATE;
        real += signal[index]! * Math.cos(angle);
        imaginary -= signal[index]! * Math.sin(angle);
    }
    return { real: real / (to - from), imaginary: imaginary / (to - from) };
}

function magnitudeOf(bin: ComplexBin): number {
    return Math.hypot(bin.real, bin.imaginary);
}

function peakMagnitude(signal: readonly number[]): number {
    let peak = 0;
    for (const sample of signal) {
        peak = Math.max(peak, Math.abs(sample));
    }
    return peak;
}

/** Normalised single-bin DFT magnitude over `[from, to)`; a sine reads its peak. */
function binMagnitude(signal: readonly number[], frequency: number, from: number, to: number): number {
    return magnitudeOf(complexBin(signal, frequency, from, to));
}

/** The recorded skip reason when no Chromium can be launched here. */
function skipWithoutRenderProof(ctx: TestContext): void {
    ctx.skip(
        true,
        `no Chromium for the real-render proof (playwright: ${launchFailure ?? 'unavailable'}) — ` +
            'run `pnpm exec playwright install chromium` to pin the render contract here'
    );
}

// A warm-up step that never settles once outran the 120s hook (run
// 42099824047) and reported only "Hook timed out". These drive the warm-up
// through stand-in steps with short deadlines; each case's own 10s timeout
// is what an unbounded step would hit instead of the named failure.
describe('de-esser render warm-up deadlines', () => {
    // The bundle bound leaves room for a loaded runner to start a real Node
    // child; the stalled-child case shortens it to keep the case quick.
    const SHORT_DEADLINES: WarmupDeadlines = { launch: 200, newPage: 200, bundle: 8_000, goto: 200, addScriptTag: 200 };
    function neverSettles<T>(): Promise<T> {
        return new Promise<T>(() => {});
    }
    const absent = (attempt: LaunchAttempt): Promise<never> =>
        Promise.reject(
            new Error(
                attempt === 'bundled'
                    ? "browserType.launch: Executable doesn't exist at /cache/chromium_headless_shell/chrome"
                    : "browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome"
            )
        );
    /** The bundled browser is absent; the system Chrome attempt does what `chrome` does. */
    function bundledAbsentThen(
        chrome: () => Promise<WarmupBrowser<WarmupPage>>
    ): (attempt: LaunchAttempt) => Promise<WarmupBrowser<WarmupPage>> {
        return (attempt) => {
            if (attempt === 'bundled') {
                return absent(attempt);
            }
            return chrome();
        };
    }
    const scriptCommand = (source: string): ChildCommand => ({ file: process.execPath, args: ['-e', source] });
    const printsBundle = scriptCommand('process.stdout.write(JSON.stringify("globalThis.__bundled = true;"))');

    function fakeBrowser(): { browser: WarmupBrowser<WarmupPage>; scripts: string[] } {
        const scripts: string[] = [];
        const page: WarmupPage = {
            goto: async () => null,
            addScriptTag: async ({ content }) => {
                scripts.push(content);
                return null;
            },
        };
        return { browser: { version: () => 'fake', newPage: async () => page }, scripts };
    }

    it('fails a bundled launch that never settles by name instead of skipping', async () => {
        const setup = prepareRenderSetup({
            launch: () => neverSettles(),
            bundleCommand: printsBundle,
            deadlines: SHORT_DEADLINES,
        });
        await expect(setup).rejects.toThrow(
            'de-esser render warm-up step "launch bundled" did not settle within 200 ms'
        );
    }, 10_000);

    it('fails a system Chrome launch that never settles by name once the bundled browser is absent', async () => {
        const setup = prepareRenderSetup({
            launch: bundledAbsentThen(() => neverSettles()),
            bundleCommand: printsBundle,
            deadlines: SHORT_DEADLINES,
        });
        await expect(setup).rejects.toThrow(
            'de-esser render warm-up step "launch channel:chrome" did not settle within 200 ms'
        );
    }, 10_000);

    it('kills a bundle child that never exits and fails by name before the page is touched', async () => {
        const { browser, scripts } = fakeBrowser();
        const setup = prepareRenderSetup({
            launch: async () => browser,
            bundleCommand: scriptCommand('setInterval(() => {}, 1000)'),
            deadlines: { ...SHORT_DEADLINES, bundle: 500 },
        });
        await expect(setup).rejects.toThrow(
            'de-esser render warm-up step "bundle" did not settle within 500 ms and was killed'
        );
        expect(scripts).toEqual([]);
    }, 10_000);

    it('skips only when both launches report the browser is not installed', async () => {
        const setup = await prepareRenderSetup({
            launch: absent,
            bundleCommand: printsBundle,
            deadlines: SHORT_DEADLINES,
        });
        expect(setup).toEqual({
            kind: 'absent',
            reason: "browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome",
        });
    }, 10_000);

    it('fails, rather than skips, a launch that rejects for any other reason', async () => {
        const setup = prepareRenderSetup({
            launch: bundledAbsentThen(() =>
                Promise.reject(new Error('browserType.launch: Host system is missing dependencies'))
            ),
            bundleCommand: printsBundle,
            deadlines: SHORT_DEADLINES,
        });
        await expect(setup).rejects.toThrow('Host system is missing dependencies');
    }, 10_000);

    it('evaluates the bundled script once every step settles in time', async () => {
        const { browser, scripts } = fakeBrowser();
        const setup = await prepareRenderSetup({
            launch: async () => browser,
            bundleCommand: printsBundle,
            deadlines: SHORT_DEADLINES,
        });
        expect(setup).toMatchObject({ kind: 'ready', browser: { version: 'fake', launch: 'bundled' } });
        expect(scripts).toEqual(['globalThis.__bundled = true;']);
    }, 10_000);
});

describe('createDeEsser real OfflineAudioContext renders', () => {
    // The cold start — Chromium launch, the esbuild child bundle, page
    // preparation — once hung the first render for its full 30s under CI
    // shard load (#4330). Warm it once here, so each test's timeout describes
    // a render, not the setup it happens to be first for. Every step carries
    // its own deadline inside this budget (`WARMUP_DEADLINES`), so a stall
    // fails under the step's name instead of as this hook's timeout.
    beforeAll(async () => {
        await pageOnce();
    }, 120_000);

    it('renders a below-threshold band tone at unity — output approximates input within 1e-3', async (ctx) => {
        const page = await pageOnce();
        if (!page) {
            skipWithoutRenderProof(ctx);
        }
        const { device, control } = await renderThroughDevice(TONE_HZ, IDLE_AMPLITUDE);
        const worst = maxAbsoluteDifference(device, control);
        expect(worst).toBeLessThan(UNITY_TOLERANCE);
    }, 30_000);

    it('reduces an above-threshold band tone but never past the declared Range', async (ctx) => {
        const page = await pageOnce();
        if (!page) {
            skipWithoutRenderProof(ctx);
        }
        const { device, control } = await renderThroughDevice(TONE_HZ, HOT_AMPLITUDE);
        const inputBin = binMagnitude(control, TONE_HZ, SETTLE_FRAMES, FRAMES);
        const outputBin = binMagnitude(device, TONE_HZ, SETTLE_FRAMES, FRAMES);
        const attenuationDb = gainToDb(outputBin / inputBin);
        // Compression engaged (the tone is measurably quieter) and inside the
        // declared limit: reduction is negative and no deeper than Range.
        expect(attenuationDb).toBeLessThan(-0.2);
        expect(attenuationDb).toBeGreaterThanOrEqual(DEFAULT_DEESSER_RANGE_DB);
    }, 30_000);

    it('stays transparent at Range 0 however hard the band is driven', async (ctx) => {
        const page = await pageOnce();
        if (!page) {
            skipWithoutRenderProof(ctx);
        }
        // Range 0 declares zero reduction: the taps weigh nothing and the hot
        // tone must pass untouched, exactly as a below-threshold tone does.
        const { device, control } = await renderThroughDevice(CENTER_TONE_HZ, HOT_AMPLITUDE, 0);
        expect(maxAbsoluteDifference(device, control)).toBeLessThan(UNITY_TOLERANCE);
    }, 30_000);

    it('reduces a fully engaged band by exactly the declared Range at −12', async (ctx) => {
        const page = await pageOnce();
        if (!page) {
            skipWithoutRenderProof(ctx);
        }
        const { control, band, device } = await renderRangeProof(CENTER_TONE_HZ, -12);
        const inputBin = complexBin(control, CENTER_TONE_HZ, SETTLE_FRAMES, FRAMES);
        const bandBin = complexBin(band, CENTER_TONE_HZ, SETTLE_FRAMES, FRAMES);
        const outputBin = complexBin(device, CENTER_TONE_HZ, SETTLE_FRAMES, FRAMES);
        // The hot tone saturates the engagement knee, so the law demands
        // output = input − (1 − w)·band with w = 10^(range/20) — the band
        // taps carry the reduction weight and the dry path stays unity.
        const weight = 1 - dbToGain(-12);
        const expectedReal = inputBin.real - weight * bandBin.real;
        const expectedImaginary = inputBin.imaginary - weight * bandBin.imaginary;
        const residual = Math.hypot(outputBin.real - expectedReal, outputBin.imaginary - expectedImaginary);
        const attenuationDb = gainToDb(magnitudeOf(outputBin) / magnitudeOf(inputBin));
        // Prepare every figure before the first assertion so a residual failure
        // retains the vectors and browser that distinguish the possible causes.
        const diagnostic =
            `Range=-12 dB; browser=${JSON.stringify(renderBrowser)}; ` +
            `inputBin=(${inputBin.real}, ${inputBin.imaginary}); bandBin=(${bandBin.real}, ${bandBin.imaginary}); ` +
            `outputBin=(${outputBin.real}, ${outputBin.imaginary}); expectedBin=(${expectedReal}, ${expectedImaginary}); ` +
            `normalizedResidual=${residual / magnitudeOf(inputBin)}; attenuationDb=${attenuationDb}; ` +
            `peaks(input, band, output)=(${peakMagnitude(control)}, ${peakMagnitude(band)}, ${peakMagnitude(device)})`;
        expect(residual / magnitudeOf(inputBin), diagnostic).toBeLessThan(0.01);
        // And the musician's reading of it: the band-centred tone drops by
        // exactly the declared 12 dB (a reduction reads as a negative gain).
        expect(attenuationDb, diagnostic).toBeCloseTo(-12, 1);
    }, 30_000);

    it('reduces a fully engaged band by exactly the declared Range at −30', async (ctx) => {
        const page = await pageOnce();
        if (!page) {
            skipWithoutRenderProof(ctx);
        }
        const { control, band, device } = await renderRangeProof(CENTER_TONE_HZ, -30);
        const inputBin = complexBin(control, CENTER_TONE_HZ, SETTLE_FRAMES, FRAMES);
        const bandBin = complexBin(band, CENTER_TONE_HZ, SETTLE_FRAMES, FRAMES);
        const outputBin = complexBin(device, CENTER_TONE_HZ, SETTLE_FRAMES, FRAMES);
        const weight = 1 - dbToGain(-30);
        const expectedReal = inputBin.real - weight * bandBin.real;
        const expectedImaginary = inputBin.imaginary - weight * bandBin.imaginary;
        const residual = Math.hypot(outputBin.real - expectedReal, outputBin.imaginary - expectedImaginary);
        const attenuationDb = gainToDb(magnitudeOf(outputBin) / magnitudeOf(inputBin));
        const diagnostic =
            `Range=-30 dB; browser=${JSON.stringify(renderBrowser)}; ` +
            `inputBin=(${inputBin.real}, ${inputBin.imaginary}); bandBin=(${bandBin.real}, ${bandBin.imaginary}); ` +
            `outputBin=(${outputBin.real}, ${outputBin.imaginary}); expectedBin=(${expectedReal}, ${expectedImaginary}); ` +
            `normalizedResidual=${residual / magnitudeOf(inputBin)}; attenuationDb=${attenuationDb}; ` +
            `peaks(input, band, output)=(${peakMagnitude(control)}, ${peakMagnitude(band)}, ${peakMagnitude(device)})`;
        expect(residual / magnitudeOf(inputBin), diagnostic).toBeLessThan(0.01);
        expect(attenuationDb, diagnostic).toBeCloseTo(-30, 1);
    }, 30_000);
});
