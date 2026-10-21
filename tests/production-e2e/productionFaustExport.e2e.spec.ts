import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type Frame, type FrameLocator, type Locator, type Page, type TestInfo } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { analyzePcmWav } from '../e2e/analyzePcmWav';

// This is a production-preview case. It deliberately uses the shipping iframe,
// native worklet loading, real transport controls and the real download path.
type LoadMode = 'pass' | 'hold-live' | 'hold-offline' | 'reject-offline';
type LoadObservation = {
    context: 'live' | 'offline';
    processorName: string;
    heldAt: number | null;
    releasedAt: number | null;
    nativeInvoked: boolean;
    nativeCompleted: boolean;
    nativeRejected: string | null;
    constructions: number;
};
type ProbeSnapshot = {
    loads: LoadObservation[];
    tapCount: number;
    finite: boolean;
    samplePeak: number;
    successNotifications: number;
};
type FaustProbe = {
    setMode: (mode: LoadMode) => void;
    release: () => void;
    snapshot: () => ProbeSnapshot;
    observeSuccess: () => void;
    stopObservingSuccess: () => void;
};

declare global {
    interface Window {
        productionFaustProbe: FaustProbe;
    }
}

function installFaustProbe(): void {
    const blobs = new Map<string, Blob>();
    const contexts = new WeakMap<AudioWorklet, { kind: 'live' | 'offline'; context: BaseAudioContext }>();
    const contextLoads = new WeakMap<BaseAudioContext, LoadObservation[]>();
    const loads: LoadObservation[] = [];
    const taps: AnalyserNode[] = [];
    const releases: Array<() => void> = [];
    let mode: LoadMode = 'hold-live';
    let successNotifications = 0;
    let successObserver: MutationObserver | undefined;
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
        const url = createObjectURL(blob);
        if (blob instanceof Blob && (blob.type === 'text/javascript' || blob.type === 'application/javascript')) {
            blobs.set(url, blob);
        }
        return url;
    };
    const NativeAudioContext = window.AudioContext;
    const NativeOfflineAudioContext = window.OfflineAudioContext;
    window.AudioContext = new Proxy(NativeAudioContext, {
        construct(target, args, newTarget) {
            const context: unknown = Reflect.construct(target, args, newTarget);
            if (!(context instanceof NativeAudioContext)) {
                throw new Error('Native AudioContext construction returned the wrong type');
            }
            contexts.set(context.audioWorklet, { kind: 'live', context });
            return context;
        },
    });
    window.OfflineAudioContext = new Proxy(NativeOfflineAudioContext, {
        construct(target, args, newTarget) {
            const context: unknown = Reflect.construct(target, args, newTarget);
            if (!(context instanceof NativeOfflineAudioContext)) {
                throw new Error('Native OfflineAudioContext construction returned the wrong type');
            }
            contexts.set(context.audioWorklet, { kind: 'offline', context });
            return context;
        },
    });
    const nativeAddModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, options) {
        const blob = blobs.get(String(url));
        const source = blob === undefined ? '' : await blob.text();
        const serialized = /const faustData = (\{[^\n]+\});/.exec(source)?.[1];
        const data: unknown = serialized === undefined ? null : JSON.parse(serialized);
        if (data === null || typeof data !== 'object' || !('dspName' in data) || data.dspName !== 'Tape_Delay') {
            return nativeAddModule.call(this, url, options);
        }
        if (!('processorName' in data) || typeof data.processorName !== 'string') {
            throw new Error('Target Faust module has no processorName');
        }
        const context = contexts.get(this);
        if (context === undefined) {
            throw new Error('Target Faust worklet has no captured native context');
        }
        const load: LoadObservation = {
            context: context.kind,
            processorName: data.processorName,
            heldAt: null,
            releasedAt: null,
            nativeInvoked: false,
            nativeCompleted: false,
            nativeRejected: null,
            constructions: 0,
        };
        loads.push(load);
        const previousLoads = contextLoads.get(context.context) ?? [];
        previousLoads.push(load);
        contextLoads.set(context.context, previousLoads);
        const hold = mode === (context.kind === 'live' ? 'hold-live' : 'hold-offline');
        const reject = context.kind === 'offline' && mode === 'reject-offline';
        if (hold) {
            load.heldAt = performance.now();
            await new Promise<void>((resolve) => releases.push(resolve));
            load.releasedAt = performance.now();
        }
        // Revocation makes the saved browser loader fail on the actual Blob URL.
        // No substituted rejection may stand in for that native promise.
        if (reject) {
            URL.revokeObjectURL(String(url));
        }
        load.nativeInvoked = true;
        try {
            await nativeAddModule.call(this, url, options);
            load.nativeCompleted = true;
        } catch (error) {
            load.nativeRejected = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            throw error;
        }
    };
    const NativeAudioWorkletNode = window.AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeAudioWorkletNode, {
        construct(target, args, newTarget) {
            const name: unknown = args[1];
            const context: unknown = args[0];
            const load =
                context instanceof BaseAudioContext
                    ? contextLoads.get(context)?.findLast((entry) => entry.processorName === name)
                    : undefined;
            if (load !== undefined) {
                load.constructions++;
            }
            const node: unknown = Reflect.construct(target, args, newTarget);
            if (!(node instanceof NativeAudioWorkletNode)) {
                throw new Error('Native AudioWorkletNode construction returned the wrong type');
            }
            if (load?.context === 'live') {
                const analyser = node.context.createAnalyser();
                analyser.fftSize = 2048;
                node.connect(analyser);
                taps.push(analyser);
            }
            return node;
        },
    });
    window.productionFaustProbe = {
        setMode(next) {
            mode = next;
        },
        release() {
            mode = 'pass';
            for (const resolve of releases.splice(0)) {
                resolve();
            }
        },
        observeSuccess() {
            successNotifications = 0;
            successObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.textContent?.includes('Ding! The audio finished baking')) {
                            successNotifications++;
                        }
                    }
                }
            });
            successObserver.observe(document.body, { childList: true, subtree: true });
        },
        stopObservingSuccess() {
            successObserver?.disconnect();
        },
        snapshot() {
            let samplePeak = 0;
            let finite = true;
            for (const tap of taps) {
                const samples = new Float32Array(tap.fftSize);
                tap.getFloatTimeDomainData(samples);
                for (const sample of samples) {
                    finite &&= Number.isFinite(sample);
                    samplePeak = Math.max(samplePeak, Math.abs(sample));
                }
            }
            return {
                loads: loads.map((load) => ({ ...load })),
                tapCount: taps.length,
                finite,
                samplePeak,
                successNotifications,
            };
        },
    };
}

async function buildIdentity(origin: string): Promise<Record<string, unknown>> {
    const paths = (await readdir('dist', { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .sort();
    const hashes = await Promise.all(
        paths.map(async (path) => ({
            path,
            sha256: createHash('sha256')
                .update(await readFile(path))
                .digest('hex'),
        }))
    );
    const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const parents = execFileSync('git', ['show', '-s', '--format=%P', 'HEAD'], { encoding: 'utf8' }).trim().split(' ');
    const head = process.env.SOURDAW_PR_HEAD;
    if (process.env.CI && !head) {
        throw new Error('Hosted production acceptance requires the PR head binding');
    }
    if (head) {
        expect([checkout, ...parents]).toContain(head);
    }
    return {
        checkout,
        parents,
        prHead: head ?? null,
        origin,
        distSha256: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
        files: hashes,
        browserCases: 1,
        classification: 'slow native module loading; no post-resolution registration race asserted',
    };
}

async function holdAndRelease(frame: Frame, context: 'live' | 'offline'): Promise<void> {
    await expect
        .poll(
            async () =>
                frame.evaluate((kind) => {
                    const load = window.productionFaustProbe
                        .snapshot()
                        .loads.findLast((entry) => entry.context === kind);
                    return load?.heldAt === null || load?.heldAt === undefined ? 0 : performance.now() - load.heldAt;
                }, context),
            { timeout: 90_000 }
        )
        .toBeGreaterThan(800);
    const held = await frame.evaluate(() => window.productionFaustProbe.snapshot());
    const load = held.loads.findLast((entry) => entry.context === context);
    expect(load).toMatchObject({ nativeInvoked: false, constructions: 0 });
    await frame.evaluate(() => window.productionFaustProbe.release());
    await expect
        .poll(
            async () =>
                frame.evaluate((kind) => {
                    const load = window.productionFaustProbe
                        .snapshot()
                        .loads.findLast((entry) => entry.context === kind);
                    return load?.nativeCompleted === true && load.constructions > 0;
                }, context),
            { timeout: 90_000 }
        )
        .toBe(true);
}

async function setShortLoop(page: Page, app: FrameLocator): Promise<void> {
    const ruler = app.getByLabel('Beat ruler', { exact: true });
    await expect(ruler).toBeVisible();
    const box = await ruler.boundingBox();
    if (!box || box.width < 300) {
        throw new Error('Beat ruler cannot expose the source-backed 8–24 beat window');
    }
    // Fresh-project timeline is 12px/beat. Nebula's Pluck begins at beat 10,
    // sends to Delay Bus, and the 8–24 window includes several delay repeats.
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 96, y);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(box.x + 288, y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await ruler.click({ position: { x: 120, y: box.height / 2 } });
}

async function openBakery(app: FrameLocator): Promise<Locator> {
    await app.locator('body').press('Control+Shift+E');
    const dialog = app.getByRole('dialog').filter({ hasText: /The Bakery/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Loop region/i }).check();
    await expect(dialog.getByRole('radio', { name: /Loop region/i })).toBeChecked();
    await dialog.getByLabel('Auto-detect').uncheck();
    await dialog.getByLabel('Tail seconds').fill('2');
    return dialog;
}

async function captureWav(page: Page, dialog: Locator, testInfo: TestInfo, name: string): Promise<Buffer> {
    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 });
    await dialog.getByRole('button', { name: 'Start Baking', exact: true }).click();
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    await expect(dialog.getByRole('button', { name: 'Close Bakery' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close Bakery' }).click();
    const path = testInfo.outputPath(`${name}.wav`);
    await download.saveAs(path);
    const bytes = await readFile(path);
    const analysis = analyzePcmWav(bytes);
    expect(analysis.channels).toBe(2);
    expect(analysis.bitsPerSample).toBe(24);
    expect(analysis.sampleRate).toBe(44_100);
    expect(analysis.durationSeconds).toBeGreaterThan(13);
    expect(analysis.durationSeconds).toBeLessThan(16);
    expect(analysis.samplePeak).toBeGreaterThan(0.001);
    expect(analysis.clippedSampleCount).toBe(0);
    await testInfo.attach(name, { path, contentType: 'audio/wav' });
    await testInfo.attach(`${name}-analysis`, { body: JSON.stringify(analysis), contentType: 'application/json' });
    return bytes;
}

function pcmContrast(active: Buffer, bypassed: Buffer): { rms: number; relativeRms: number; samples: number } {
    // Decode the actual PCM payload, not container metadata or a file hash.
    function payload(bytes: Buffer): Buffer {
        let offset = 12;
        while (offset + 8 <= bytes.length) {
            const size = bytes.readUInt32LE(offset + 4);
            if (bytes.toString('ascii', offset, offset + 4) === 'data') {
                return bytes.subarray(offset + 8, offset + 8 + size);
            }
            offset += 8 + size + (size % 2);
        }
        throw new Error('WAV has no PCM data');
    }
    const wet = payload(active);
    const dry = payload(bypassed);
    expect(wet.length).toBe(dry.length);
    // Exclude the leading second; retain the source notes and the manual tail.
    const start = 44_100 * 2 * 3;
    let deltaEnergy = 0;
    let referenceEnergy = 0;
    let samples = 0;
    for (let offset = start; offset + 3 <= wet.length; offset += 3) {
        const a = wet.readIntLE(offset, 3) / 0x80_0000;
        const b = dry.readIntLE(offset, 3) / 0x80_0000;
        deltaEnergy += (a - b) ** 2;
        referenceEnergy += b ** 2;
        samples++;
    }
    expect(samples).toBeGreaterThan(44_100);
    return { rms: Math.sqrt(deltaEnergy / samples), relativeRms: Math.sqrt(deltaEnergy / referenceEnergy), samples };
}

test('production Faust plays and exports after slow native loading, refuses a native failure, and retries', async ({
    page,
}, testInfo) => {
    const origin = testInfo.project.use.baseURL;
    if (typeof origin !== 'string') {
        throw new Error('Production preview origin is missing');
    }
    const identity = await buildIdentity(origin);
    const observations: Record<string, unknown> = { identity };
    let frame: Frame | undefined;
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    try {
        const dismissed = superjsonStringify(true);
        await page.addInitScript((alphaDismissed) => {
            Reflect.deleteProperty(window, 'showSaveFilePicker');
            if (window.parent === window) {
                localStorage.clear();
                localStorage.setItem('wd:onboarding-completed', '1');
                localStorage.setItem('sourdaw-alpha-notice-dismissed', alphaDismissed);
                localStorage.setItem('wd:first-load-hint-shown', '1');
            }
        }, dismissed);
        await page.addInitScript(installFaustProbe);
        const response = await page.goto('/');
        expect(response).not.toBeNull();
        if (response === null) {
            throw new Error('Production preview returned no document');
        }
        expect(await response.body()).toEqual(await readFile('dist/index.html'));
        await expect(page.locator('iframe[title="Sourdaw"]')).toHaveCount(1);
        const element = await page.locator('iframe[title="Sourdaw"]').elementHandle();
        frame = (await element?.contentFrame()) ?? undefined;
        if (!frame) {
            throw new Error('Shipping application iframe did not mount');
        }
        expect(await frame.evaluate(() => ({ isolated: crossOriginIsolated, secure: isSecureContext }))).toEqual({
            isolated: true,
            secure: true,
        });
        const app = page.frameLocator('iframe[title="Sourdaw"]');
        await expect(app.getByLabel('Sourdaw — start a project')).toBeVisible({ timeout: 90_000 });
        await app.locator('#launch-demo-project').click();
        await app.getByRole('button', { name: /Nebula Drift/i }).click();
        await holdAndRelease(frame, 'live');
        await expect(app.getByRole('button', { name: 'Nebula Drift', exact: true })).toBeVisible({ timeout: 90_000 });
        await setShortLoop(page, app);
        await app.getByRole('button', { name: 'Play', exact: true }).click();
        await expect
            .poll(
                async () => {
                    const snapshot = await frame!.evaluate(() => window.productionFaustProbe.snapshot());
                    expect(snapshot.finite).toBe(true);
                    expect(snapshot.tapCount).toBeGreaterThan(0);
                    observations.livePcm = snapshot;
                    return snapshot.samplePeak;
                },
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0.0001);
        await app.getByRole('button', { name: 'Stop', exact: true }).click();
        await frame.evaluate(() => window.productionFaustProbe.setMode('hold-offline'));
        let dialog = await openBakery(app);
        const activePromise = captureWav(page, dialog, testInfo, 'active-tape-delay');
        await holdAndRelease(frame, 'offline');
        const active = await activePromise;
        // Select the actual bus through its visible track row, then toggle the
        // device's own inspector control; no store or app-action bridge is used.
        await app
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByText('Delay Bus', { exact: true })
            .first()
            .click();
        const inspector = app.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Bypass Tape Delay', exact: true }).click();
        await expect(inspector.getByRole('button', { name: 'Enable Tape Delay', exact: true })).toBeVisible();
        const beforeBypass = (await frame.evaluate(() => window.productionFaustProbe.snapshot())).loads.filter(
            (load) => load.context === 'offline'
        ).length;
        dialog = await openBakery(app);
        const bypassed = await captureWav(page, dialog, testInfo, 'bypassed-tape-delay');
        expect(
            (await frame.evaluate(() => window.productionFaustProbe.snapshot())).loads.filter(
                (load) => load.context === 'offline'
            )
        ).toHaveLength(beforeBypass);
        const contrast = pcmContrast(active, bypassed);
        observations.activeBypassContrast = contrast;
        expect(contrast.rms).toBeGreaterThan(0.0001);
        expect(contrast.relativeRms).toBeGreaterThan(0.005);
        await inspector.getByRole('button', { name: 'Enable Tape Delay', exact: true }).click();
        await expect(inspector.getByRole('button', { name: 'Bypass Tape Delay', exact: true })).toBeVisible();
        await expect(app.getByText('Ding! The audio finished baking', { exact: true })).toHaveCount(0);
        await frame.evaluate(() => {
            window.productionFaustProbe.setMode('reject-offline');
            window.productionFaustProbe.observeSuccess();
        });
        dialog = await openBakery(app);
        const beforeFailure = downloads.length;
        await dialog.getByRole('button', { name: 'Start Baking', exact: true }).click();
        await expect(dialog.getByText('The bread burned...', { exact: true })).toBeVisible({ timeout: 90_000 });
        await expect(dialog.getByText(/Delay Bus.*Tape Delay|Tape Delay.*Delay Bus/)).toBeVisible();
        const failed = (await frame.evaluate(() => window.productionFaustProbe.snapshot())).loads.findLast(
            (load) => load.context === 'offline'
        );
        expect(failed).toMatchObject({ nativeInvoked: true, nativeCompleted: false, constructions: 0 });
        expect(failed?.nativeRejected).toBeTruthy();
        expect(downloads).toHaveLength(beforeFailure);
        await expect(app.getByText('Ding! The audio finished baking', { exact: true })).toHaveCount(0);
        const retry = dialog.getByRole('button', { name: 'Start Baking', exact: true });
        await expect(retry).toBeEnabled();
        expect((await frame.evaluate(() => window.productionFaustProbe.snapshot())).successNotifications).toBe(0);
        await frame.evaluate(() => window.productionFaustProbe.stopObservingSuccess());
        observations.failedLoad = failed;
        await frame.evaluate(() => window.productionFaustProbe.setMode('pass'));
        const recovered = await captureWav(page, dialog, testInfo, 'same-page-recovered-tape-delay');
        const recoveryContrast = pcmContrast(recovered, bypassed);
        observations.recoveryBypassContrast = recoveryContrast;
        const repeatedActiveContrast = pcmContrast(recovered, active);
        observations.repeatedActiveContrast = repeatedActiveContrast;
        // Repeated active PCM controls for unrelated synth variation.
        expect(repeatedActiveContrast.rms).toBeLessThan(contrast.rms / 4);
        expect(recoveryContrast.rms).toBeGreaterThan(0.0001);
        expect(recoveryContrast.relativeRms).toBeGreaterThan(0.005);
        const recoveredLoad = (await frame.evaluate(() => window.productionFaustProbe.snapshot())).loads.findLast(
            (load) => load.context === 'offline'
        );
        expect(recoveredLoad).toMatchObject({
            nativeInvoked: true,
            nativeCompleted: true,
            nativeRejected: null,
            constructions: 1,
        });
        expect(downloads).toHaveLength(beforeFailure + 1);
    } finally {
        if (frame) {
            observations.finalProbe = await frame
                .evaluate(() => window.productionFaustProbe.snapshot())
                .catch((error: unknown) => String(error));
        }
        observations.downloads = downloads;
        await testInfo.attach('production-faust-observations', {
            body: JSON.stringify(observations, null, 2),
            contentType: 'application/json',
        });
        console.log(`production-faust-observations ${JSON.stringify(observations)}`);
    }
});
