import { expect, test } from '@playwright/test';

import { setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const AUDITION_WINDOWS = [
    { name: 'Pressure Bloom', startBeat: 128, endBeat: 192 },
    { name: 'Psilocybin Chapel', startBeat: 288, endBeat: 352 },
    { name: 'Singularity Build', startBeat: 352, endBeat: 416 },
    { name: 'False Floor', startBeat: 480, endBeat: 484, renderStartBeat: 416 },
    { name: 'Dissolution', startBeat: 544, endBeat: 576 },
] as const;

const ALLOWED_WARNING_FRAGMENTS = [
    'using deprecated parameters for `initSync()`',
    '[MIDI] Web MIDI failed, trying Tauri fallback',
    'No available adapters.',
] as const;

test('renders signal evidence for every required Mycelium automation audition window', async ({ page }, testInfo) => {
    test.setTimeout(1_200_000);
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new TypeError('Mycelium stem E2E requires a configured Playwright baseURL');
    }
    const appOrigin = new URL(configuredBaseUrl).origin;
    const consoleErrors: string[] = [];
    const unexpectedWarnings: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const externalRequests: string[] = [];
    const httpErrors: string[] = [];

    page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error') {
            consoleErrors.push(text);
        }
        if (message.type() === 'warning' && !ALLOWED_WARNING_FRAGMENTS.some((fragment) => text.includes(fragment))) {
            unexpectedWarnings.push(text);
        }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
        const failure = request.failure()?.errorText ?? 'unknown request failure';
        if (failure !== 'net::ERR_ABORTED') {
            failedRequests.push(`${failure} ${request.method()} ${request.url()}`);
        }
    });
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.origin !== appOrigin) {
            externalRequests.push(`${request.method()} ${request.url()}`);
        }
    });
    page.on('response', (response) => {
        if (response.status() >= 400) {
            httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
        }
    });

    await setupWorkspace(page);
    await page.locator('#launch-demo-project').click();
    const card = page.getByRole('button', { name: /Mycelium Ascendant/i });
    await expect(card).toBeVisible();
    await card.click();
    await wait_for_workspace_ready(page);
    await expect(page.getByRole('button', { name: 'Mycelium Ascendant' })).toBeVisible();
    await page.reload();
    await wait_for_workspace_ready(page);
    await expect(page.getByRole('button', { name: 'Mycelium Ascendant' })).toBeVisible();

    const report = await page.evaluate(async (auditionWindows) => {
        type ExportStemsModule = {
            exportStems: (options: {
                startBeat: number;
                durationBeats: number;
                sampleRate: number;
                tailSeconds: number;
                onWarning: (warning: string) => void;
            }) => Promise<Map<string, AudioBuffer>>;
        };
        type TrackStoreModule = {
            trackStore: { value: { tracks: { id: string; name: string }[] } | null };
        };
        type TempoChange = { beat: number; tempo: number; curve: 'instant' | 'linear' };
        type TransportStoreModule = {
            tempoMapStore: { value: { changes: TempoChange[] } | null };
            transportStore: { value: { tempo: number } | null };
        };
        type TempoMathModule = {
            beatToSamples: (
                changes: readonly TempoChange[],
                beat: number,
                defaultTempo: number,
                sampleRate: number
            ) => number;
        };
        const isRecord = (value: unknown): value is Record<string, unknown> =>
            typeof value === 'object' && value !== null;
        const isExportStemsModule = (value: unknown): value is ExportStemsModule =>
            isRecord(value) && typeof value.exportStems === 'function';
        const isTrackStoreModule = (value: unknown): value is TrackStoreModule => {
            if (!isRecord(value) || !isRecord(value.trackStore)) {
                return false;
            }
            const state = value.trackStore.value;
            if (!isRecord(state) || !Array.isArray(state.tracks)) {
                return false;
            }
            return state.tracks.every(
                (track: unknown) => isRecord(track) && typeof track.id === 'string' && typeof track.name === 'string'
            );
        };
        const isTransportStoreModule = (value: unknown): value is TransportStoreModule => {
            if (!isRecord(value) || !isRecord(value.tempoMapStore) || !isRecord(value.transportStore)) {
                return false;
            }
            const tempoMap = value.tempoMapStore.value;
            const transport = value.transportStore.value;
            if (!isRecord(tempoMap) || !Array.isArray(tempoMap.changes) || !isRecord(transport)) {
                return false;
            }
            return (
                typeof transport.tempo === 'number' &&
                tempoMap.changes.every(
                    (change: unknown) =>
                        isRecord(change) &&
                        typeof change.beat === 'number' &&
                        typeof change.tempo === 'number' &&
                        (change.curve === 'instant' || change.curve === 'linear')
                )
            );
        };
        const isTempoMathModule = (value: unknown): value is TempoMathModule =>
            isRecord(value) && typeof value.beatToSamples === 'function';
        const audioEngineModule: unknown = await import('/src/modules/AudioEngine/useCases/index.ts');
        const arrangementStoreModule: unknown = await import('/src/modules/Arrangement/stores/index.ts');
        const transportStoreModule: unknown = await import('/src/modules/Transport/stores/index.ts');
        const tempoMathModule: unknown = await import('/src/modules/Transport/models/TempoMap.ts');
        if (!isExportStemsModule(audioEngineModule) || !isTrackStoreModule(arrangementStoreModule)) {
            throw new TypeError('Mycelium stem E2E could not resolve the browser render contracts');
        }
        if (!isTransportStoreModule(transportStoreModule) || !isTempoMathModule(tempoMathModule)) {
            throw new TypeError('Mycelium stem E2E could not resolve the browser tempo contracts');
        }
        const { exportStems } = audioEngineModule;
        const { trackStore } = arrangementStoreModule;
        const { tempoMapStore, transportStore } = transportStoreModule;
        const { beatToSamples } = tempoMathModule;
        const tempoMap = tempoMapStore.value;
        const transport = transportStore.value;
        if (!tempoMap || !transport) {
            throw new TypeError('Mycelium stem E2E found empty tempo state');
        }
        const trackNames = new Map(trackStore.value?.tracks.map((track) => [track.id, track.name]) ?? []);
        const windows = [];

        for (const auditionWindow of auditionWindows) {
            const warnings: string[] = [];
            const sampleRate = 44_100;
            const renderStartBeat =
                'renderStartBeat' in auditionWindow ? auditionWindow.renderStartBeat : auditionWindow.startBeat;
            const renderStartSample = beatToSamples(tempoMap.changes, renderStartBeat, transport.tempo, sampleRate);
            const analysisStartFrame =
                beatToSamples(tempoMap.changes, auditionWindow.startBeat, transport.tempo, sampleRate) -
                renderStartSample;
            const analysisEndFrame =
                beatToSamples(tempoMap.changes, auditionWindow.endBeat, transport.tempo, sampleRate) -
                renderStartSample;
            const stems = await exportStems({
                startBeat: renderStartBeat,
                durationBeats: auditionWindow.endBeat - renderStartBeat,
                sampleRate,
                tailSeconds: 0,
                onWarning: (warning: string) => warnings.push(warning),
            });
            const stemMetrics = [...stems.entries()].map(([trackId, buffer]) => {
                let samplePeak = 0;
                let sumSquares = 0;
                let sampleCount = 0;
                let activeBlocks = 0;
                let blockCount = 0;
                const blockFrames = 2_048;
                const firstAnalysisFrame = Math.max(0, analysisStartFrame);
                const lastAnalysisFrame = Math.min(buffer.length, analysisEndFrame);

                for (let blockStart = firstAnalysisFrame; blockStart < lastAnalysisFrame; blockStart += blockFrames) {
                    const blockEnd = Math.min(lastAnalysisFrame, blockStart + blockFrames);
                    let blockSquares = 0;
                    let blockSamples = 0;
                    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                        const samples = buffer.getChannelData(channel);
                        for (let index = blockStart; index < blockEnd; index++) {
                            const sample = samples[index];
                            samplePeak = Math.max(samplePeak, Math.abs(sample));
                            const square = sample * sample;
                            sumSquares += square;
                            blockSquares += square;
                            sampleCount++;
                            blockSamples++;
                        }
                    }
                    if (Math.sqrt(blockSquares / blockSamples) > 0.0001) {
                        activeBlocks++;
                    }
                    blockCount++;
                }

                return {
                    trackId,
                    trackName: trackNames.get(trackId) ?? trackId,
                    channels: buffer.numberOfChannels,
                    sampleRate: buffer.sampleRate,
                    durationSeconds: (lastAnalysisFrame - firstAnalysisFrame) / buffer.sampleRate,
                    renderDurationSeconds: buffer.duration,
                    samplePeak,
                    rms: Math.sqrt(sumSquares / sampleCount),
                    activeBlockRatio: activeBlocks / blockCount,
                };
            });
            stemMetrics.sort((first, second) => second.rms - first.rms);
            windows.push({
                ...auditionWindow,
                warnings,
                stemCount: stemMetrics.length,
                audibleStemCount: stemMetrics.filter((stem) => stem.rms > 0.00001).length,
                stems: stemMetrics,
            });
            stems.clear();
        }
        return { capturedAt: new Date().toISOString(), sampleRate: 44_100, windows };
    }, AUDITION_WINDOWS);
    await testInfo.attach('mycelium-automation-stem-evidence', {
        body: JSON.stringify(report),
        contentType: 'application/json',
    });

    expect(report.windows).toHaveLength(AUDITION_WINDOWS.length);
    for (const window of report.windows) {
        expect(window.warnings).toEqual([]);
        expect(window.stemCount).toBeGreaterThan(15);
        expect(window.audibleStemCount).toBeGreaterThan(0);
        expect(window.stems.every((stem) => stem.channels === 2)).toBe(true);
        expect(window.stems.every((stem) => stem.sampleRate === 44_100)).toBe(true);
        expect(window.stems.every((stem) => Number.isFinite(stem.rms))).toBe(true);
    }
    const signals = new Map(
        report.windows.map((window) => [window.name, new Map(window.stems.map((stem) => [stem.trackName, stem]))])
    );
    expect(signals.get('Pressure Bloom')?.get('Rolling Colony')?.rms).toBeGreaterThan(0.1);
    expect(signals.get('Pressure Bloom')?.get('Fractal Riser')?.activeBlockRatio).toBeGreaterThan(0.5);
    expect(signals.get('Psilocybin Chapel')?.get('Root Drone')?.activeBlockRatio).toBeGreaterThan(0.9);
    expect(signals.get('Psilocybin Chapel')?.get('Grand Boule Ritual')?.samplePeak).toBeGreaterThan(0.1);
    expect(signals.get('Singularity Build')?.get('Triplet Helix')?.activeBlockRatio).toBeGreaterThan(0.5);
    expect(signals.get('Singularity Build')?.get('Pulse Engine')?.samplePeak).toBeGreaterThan(0.1);
    expect(signals.get('False Floor')?.get('Pulse Engine')?.samplePeak).toBeLessThan(1e-10);
    expect(signals.get('False Floor')?.get('Rolling Colony')?.samplePeak).toBeLessThan(1e-10);
    expect(signals.get('False Floor')?.get('Sub Mycelium')?.samplePeak).toBeLessThan(1e-10);
    expect(signals.get('Dissolution')?.get('Root Drone')?.activeBlockRatio).toBeGreaterThan(0.9);
    expect(signals.get('Dissolution')?.get('Main Vision')?.samplePeak).toBeGreaterThan(0.1);
    expect(consoleErrors).toEqual([]);
    expect(unexpectedWarnings).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(httpErrors).toEqual([]);
});
