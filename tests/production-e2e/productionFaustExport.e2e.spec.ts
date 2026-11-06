import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type Frame, type FrameLocator, type Locator, type Page, type TestInfo } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { analyzePcmWav } from '../e2e/analyzePcmWav';
import { installFilePickerCapture, type FilePickerCapture } from '../e2e/exportFilePickerCapture';

import { installFaustProbe } from './productionFaustProbe';
import { admitProductionTransportInput } from './productionTransportInput';

// This is a production-preview case. It deliberately uses the shipping iframe,
// native worklet loading, real transport controls and controlled picker storage.
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
        // This revision consumes the build; a reused producer is bound separately by the runner.
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
    await expect(app.getByRole('dialog', { name: 'Sourdaw — start a project', exact: true })).toHaveCount(0, {
        timeout: 90_000,
    });
    const minimap = app.getByRole('slider', {
        name: 'Timeline minimap — drag the viewport to scroll, click to jump, or use arrow keys',
        exact: true,
    });
    await expect(minimap).toBeVisible();
    await minimap.focus();
    await expect(minimap).toBeFocused();
    // The public Zoom Out shortcut subtracts 4px/beat from the fresh 12px/beat.
    await minimap.press('-');
    await minimap.press('-');
    await minimap.press('Home');
    const pixelsPerBeat = 4;
    const loopStart = 104;
    const loopEnd = 120;
    const ruler = app.getByLabel('Beat ruler', { exact: true });
    await expect(ruler).toBeVisible();
    await ruler.click({ trial: true });
    const box = await ruler.boundingBox();
    if (!box || box.width <= loopEnd * pixelsPerBeat) {
        throw new Error('Beat ruler cannot expose the source-backed 104–120 beat window');
    }
    // Pluck's gain automation reaches 0.4 at beat 104, feeding its post-fader send.
    // Stay inside each edge so the ruler's floor/ceil commits exactly 104–120.
    const edgeInsetPx = 0.25;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + loopStart * pixelsPerBeat + edgeInsetPx, y);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(box.x + loopEnd * pixelsPerBeat - edgeInsetPx, y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await ruler.click({ trial: true });
    const seekBox = await ruler.boundingBox();
    if (!seekBox) {
        throw new Error('Beat ruler disappeared before the exact loop-start seek');
    }
    // Raw page coordinates share getBeat's border-box origin; locator click
    // positions would add the ruler's border before the pixel-to-beat mapping.
    await page.mouse.click(seekBox.x + loopStart * pixelsPerBeat, seekBox.y + seekBox.height / 2);
    await expect(app.getByTestId('transport-playhead')).toHaveText(/^Bars\s*27\s*\.\s*1\s*\.\s*000$/);
}

async function openBakery(app: FrameLocator): Promise<Locator> {
    const isMac = await app.locator('body').evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await app.locator('body').press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    const dialog = app.getByRole('dialog').filter({ hasText: /The Bakery/i });
    await expect(dialog).toBeVisible();
    const exactLoop = dialog.getByRole('radio', { name: 'Loop region (beat 104.00 → 120.00)', exact: true });
    await expect(exactLoop).toBeVisible();
    await expect(exactLoop).toBeEnabled();
    await dialog.getByRole('radio', { name: /Loop region/i }).check();
    await expect(dialog.getByRole('radio', { name: /Loop region/i })).toBeChecked();
    await expect(exactLoop).toBeChecked();
    await dialog.getByLabel('Auto-detect').uncheck();
    await dialog.getByLabel('Tail seconds').fill('2');
    return dialog;
}

type SavedCapture = {
    name: string;
    filename: string;
    bytes: number;
    writes: number;
    closes: number;
    aborts: number;
    requests: number;
    writables: number;
};

function captureCounts(capture: FilePickerCapture) {
    return {
        bytes: capture.bytesWritten(),
        writes: capture.writeCount(),
        closes: capture.closeCount(),
        aborts: capture.abortCount(),
        requests: capture.pickerCount(),
        writables: capture.writableCount(),
    };
}

function captureState(capture: FilePickerCapture) {
    capture.assertHealthy();
    return captureCounts(capture);
}

async function captureWav(
    dialog: Locator,
    testInfo: TestInfo,
    name: string,
    capture: FilePickerCapture,
    completed: SavedCapture[]
): Promise<Buffer> {
    await dialog.getByRole('button', { name: 'Start Baking', exact: true }).click();
    await expect.poll(() => capture.closeCount(), { timeout: 180_000 }).toBe(1);
    await capture.waitForClose();
    const filename = await capture.pickerFilename;
    expect(filename).toMatch(/^Sourdaw_Bake_\d+\.wav$/);
    const saved = captureState(capture);
    expect(saved.bytes).toBeGreaterThan(0);
    expect(saved.writes).toBeGreaterThan(0);
    expect(saved.closes).toBe(1);
    expect(saved.aborts).toBe(0);
    expect(saved.requests).toBe(1);
    expect(saved.writables).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Close Bakery' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close Bakery' }).click();
    const path = capture.path;
    const bytes = await readFile(path);
    expect(bytes.length).toBe(saved.bytes);
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
    completed.push({ name, filename, ...saved });
    await capture.retire();
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
    let transportInput: Awaited<ReturnType<typeof admitProductionTransportInput>> | undefined;
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    const captures: FilePickerCapture[] = [];
    const completed: SavedCapture[] = [];
    const newCapture = async (name: string) => {
        const capture = await installFilePickerCapture(page, testInfo.outputPath(name), {
            initializeCurrentFrames: true,
        });
        captures.push(capture);
        return capture;
    };
    try {
        const activeCapture = await newCapture('active-tape-delay.wav');
        const dismissed = superjsonStringify(true);
        await page.addInitScript((alphaDismissed) => {
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
        await expect(app.getByRole('button', { name: 'Nebula Drift (Demo)', exact: true })).toBeVisible({
            timeout: 90_000,
        });
        await setShortLoop(page, app);
        const rangeDialog = await openBakery(app);
        await rangeDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(rangeDialog).toHaveCount(0);
        transportInput = await admitProductionTransportInput(page, app);
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
        await transportInput.stop();
        await frame.evaluate(() => window.productionFaustProbe.setMode('hold-offline'));
        let dialog = await openBakery(app);
        const activePromise = captureWav(dialog, testInfo, 'active-tape-delay', activeCapture, completed);
        await holdAndRelease(frame, 'offline');
        const active = await activePromise;
        // Select the actual bus through its visible track row; the mute and
        // device controls exercise the real UI, not the store or action bridge.
        await app
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByText('Delay Bus', { exact: true })
            .first()
            .click();
        const inspector = app.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector.getByRole('button', { name: 'Bypass Tape Delay', exact: true })).toBeVisible();
        const trackList = app.getByRole('grid', { name: /Track list/i }).first();
        const beforeMuted = (await frame.evaluate(() => window.productionFaustProbe.snapshot())).loads.filter(
            (load) => load.context === 'offline'
        ).length;
        await trackList.getByRole('button', { name: 'Mute Delay Bus', exact: true }).click();
        await expect(trackList.getByRole('button', { name: 'Unmute Delay Bus', exact: true })).toBeVisible();
        const mutedCapture = await newCapture('muted-delay-bus.wav');
        dialog = await openBakery(app);
        const muted = await captureWav(dialog, testInfo, 'muted-delay-bus', mutedCapture, completed);
        const mutedLoads = (await frame.evaluate(() => window.productionFaustProbe.snapshot())).loads.filter(
            (load) => load.context === 'offline'
        );
        expect(mutedLoads).toHaveLength(beforeMuted + 1);
        expect(mutedLoads.at(-1)).toMatchObject({ nativeCompleted: true, constructions: 1 });
        const mutedReturnContrast = pcmContrast(active, muted);
        observations.activeMutedReturnContrast = mutedReturnContrast;
        expect(mutedReturnContrast.rms).toBeGreaterThan(0.0001);
        expect(mutedReturnContrast.relativeRms).toBeGreaterThan(0.005);
        await trackList.getByRole('button', { name: 'Unmute Delay Bus', exact: true }).click();
        await expect(trackList.getByRole('button', { name: 'Mute Delay Bus', exact: true })).toBeVisible();
        await inspector.getByRole('button', { name: 'Bypass Tape Delay', exact: true }).click();
        await expect(inspector.getByRole('button', { name: 'Enable Tape Delay', exact: true })).toBeVisible();
        const beforeBypass = (await frame.evaluate(() => window.productionFaustProbe.snapshot())).loads.filter(
            (load) => load.context === 'offline'
        ).length;
        const bypassCapture = await newCapture('bypassed-tape-delay.wav');
        dialog = await openBakery(app);
        const bypassed = await captureWav(dialog, testInfo, 'bypassed-tape-delay', bypassCapture, completed);
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
        const previousSuccess = app.getByRole('alert').filter({ hasText: /^Ding! The audio finished baking$/ });
        await expect(previousSuccess).toHaveCount(1);
        await expect(previousSuccess).toBeVisible();
        await previousSuccess.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
        await expect(app.getByText('Ding! The audio finished baking', { exact: true })).toHaveCount(0);
        await frame.evaluate(() => {
            window.productionFaustProbe.setMode('reject-offline');
            window.productionFaustProbe.observeSuccess();
        });
        // This precreated staging artifact is not a completed user WAV.
        const failedCapture = await newCapture('native-failure-aborted.incomplete');
        dialog = await openBakery(app);
        const beforeFailure = completed.length;
        await dialog.getByRole('button', { name: 'Start Baking', exact: true }).click();
        await expect(dialog.getByText('The bread burned...', { exact: true })).toBeVisible({ timeout: 90_000 });
        await expect(dialog.getByText(/Delay Bus.*Tape Delay|Tape Delay.*Delay Bus/)).toBeVisible();
        const failed = (await frame.evaluate(() => window.productionFaustProbe.snapshot())).loads.findLast(
            (load) => load.context === 'offline'
        );
        expect(failed).toMatchObject({ nativeInvoked: true, nativeCompleted: false, constructions: 0 });
        expect(failed?.nativeRejected).toBeTruthy();
        await failedCapture.waitForAbort();
        const failedState = captureState(failedCapture);
        expect(failedState).toMatchObject({ closes: 0, aborts: 1, requests: 1, writables: 1 });
        const incomplete = await readFile(failedCapture.path);
        expect(incomplete.length).toBe(failedState.bytes);
        expect(() => analyzePcmWav(incomplete)).toThrow();
        await testInfo.attach('native-failure-aborted-artifact', {
            path: failedCapture.path,
            contentType: 'application/octet-stream',
        });
        expect(completed).toHaveLength(beforeFailure);
        expect(downloads).toHaveLength(0);
        await expect(app.getByText('Ding! The audio finished baking', { exact: true })).toHaveCount(0);
        const retry = dialog.getByRole('button', { name: 'Start Baking', exact: true });
        await expect(retry).toBeEnabled();
        expect((await frame.evaluate(() => window.productionFaustProbe.snapshot())).successNotifications).toBe(0);
        await frame.evaluate(() => window.productionFaustProbe.stopObservingSuccess());
        observations.failedLoad = failed;
        observations.failedCapture = captureState(failedCapture);
        await failedCapture.retire();
        await frame.evaluate(() => window.productionFaustProbe.setMode('pass'));
        const recoveryCapture = await newCapture('same-page-recovered-tape-delay.wav');
        const recovered = await captureWav(
            dialog,
            testInfo,
            'same-page-recovered-tape-delay',
            recoveryCapture,
            completed
        );
        const recoveryContrast = pcmContrast(recovered, bypassed);
        observations.recoveryBypassContrast = recoveryContrast;
        const repeatedActiveContrast = pcmContrast(recovered, active);
        observations.repeatedActiveContrast = repeatedActiveContrast;
        // Repeated active PCM controls for unrelated synth variation.
        expect(repeatedActiveContrast.rms).toBeLessThan(contrast.rms / 4);
        expect(repeatedActiveContrast.rms).toBeLessThan(mutedReturnContrast.rms / 4);
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
        expect(completed).toHaveLength(beforeFailure + 1);
        expect(captureState(failedCapture)).toEqual(failedState);
        expect(await readFile(failedCapture.path)).toEqual(incomplete);
        expect(downloads).toHaveLength(0);
    } finally {
        try {
            observations.transportInput = transportInput?.snapshot();
            transportInput?.dispose();
            if (frame) {
                observations.finalProbe = await frame
                    .evaluate(() => window.productionFaustProbe.snapshot())
                    .catch((error: unknown) => String(error));
            }
            observations.downloads = downloads;
            observations.completedPickerCaptures = completed;
            observations.pickerCaptures = captures.map((capture) => ({
                path: capture.path,
                ...captureCounts(capture),
            }));
            await testInfo.attach('production-faust-observations', {
                body: JSON.stringify(observations, null, 2),
                contentType: 'application/json',
            });
            console.log(`production-faust-observations ${JSON.stringify(observations)}`);
        } finally {
            await Promise.all(captures.map((capture) => capture.dispose()));
            for (const capture of captures) {
                capture.assertHealthy();
            }
        }
    }
});
