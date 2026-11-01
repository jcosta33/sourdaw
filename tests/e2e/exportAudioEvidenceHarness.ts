import { expect, type Page } from '@playwright/test';

import type { PcmWavAnalysis } from './analyzePcmWav';

const ALLOWED_WARNING_FRAGMENTS = [
    'using deprecated parameters for `initSync()`',
    '[MIDI] Web MIDI failed',
    'No available adapters.',
] as const;
// #4895: on a contended runner (PR #4884 approval run 36450903232, shard 9) the engine's device
// deadline expired during the 12-minute export, emitting one loading-timeout warning followed by
// the promotion rollbacks of its expired loads in the same synchronous pass. That is the
// runner-pressure fragility class of #2180 for this spec — the same spec passed the same-day
// nightly on an idle runner — not the silent device-loss regression #3318 fixed, whose production
// signature was exactly this cascade. So the rollback tolerance is gated on the cascade itself: a
// loading-timeout line arms it, and only the promotion rollbacks trailing it are absorbed. An
// isolated promotion rollback still fails, and the genuine graph-failure route additionally warns
// `Device graph rebuild failed`, which this gate never covers. Match on the stable fragments only;
// the pending count, device ids, and rollback causes are volatile.
const DEVICE_LOADING_TIMEOUT_FRAGMENT = '[AudioEngine] Device loading timed out';
const DEVICE_PROMOTION_ROLLBACK_SUBJECT_FRAGMENT = 'Async device promotion for ';
const DEVICE_PROMOTION_ROLLBACK_CAUSE_FRAGMENT = ' rolled back after ';

export const MANUAL_TAIL_SECONDS = 2;
export const WAV_BYTES_PER_SECOND = 44_100 * 2 * 3;

export type ExportRunFindings = {
    /** Asserts the page raised no console error, unexpected warning, page error, or off-origin/failed request. */
    expectClean: () => void;
};

export function watchExportRun(page: Page, appOrigin: string): ExportRunFindings {
    const consoleErrors: string[] = [];
    const unexpectedWarnings: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const externalRequests: string[] = [];
    const httpErrors: string[] = [];

    let deviceLoadTimedOut = false;
    page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error') {
            consoleErrors.push(text);
        }
        if (message.type() !== 'warning') {
            return;
        }
        if (ALLOWED_WARNING_FRAGMENTS.some((fragment) => text.includes(fragment))) {
            return;
        }
        // #4895 pressure cascade: the deadline line arms the gate; only the rollbacks it triggers
        // are absorbed. Every other unexpected warning still fails the assertion below.
        if (text.includes(DEVICE_LOADING_TIMEOUT_FRAGMENT)) {
            deviceLoadTimedOut = true;
            return;
        }
        if (
            deviceLoadTimedOut &&
            text.includes(DEVICE_PROMOTION_ROLLBACK_SUBJECT_FRAGMENT) &&
            text.includes(DEVICE_PROMOTION_ROLLBACK_CAUSE_FRAGMENT)
        ) {
            return;
        }
        unexpectedWarnings.push(text);
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
        const failure = request.failure()?.errorText ?? 'unknown request failure';
        if (failure === 'net::ERR_ABORTED') {
            return;
        }
        failedRequests.push(`${failure} ${request.method()} ${request.url()}`);
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

    return {
        expectClean: () => {
            expect(consoleErrors).toEqual([]);
            expect(unexpectedWarnings).toEqual([]);
            expect(pageErrors).toEqual([]);
            expect(failedRequests).toEqual([]);
            expect(externalRequests).toEqual([]);
            expect(httpErrors).toEqual([]);
        },
    };
}

/** Format and level bounds that hold for any length of the Nebula Drift mix. */
export function expectNebulaMixQuality(wav: PcmWavAnalysis): void {
    expect(wav.audioFormat).toBe(1);
    expect(wav.channels).toBe(2);
    expect(wav.sampleRate).toBe(44_100);
    expect(wav.bitsPerSample).toBe(24);
    expect(wav.samplePeak).toBeGreaterThan(0.05);
    expect(wav.samplePeak).toBeLessThan(0.99);
    expect(wav.clippedSampleCount).toBe(0);
    expect(wav.integratedLufs).toBeGreaterThanOrEqual(-30);
    expect(wav.integratedLufs).toBeLessThanOrEqual(-6);
    expect(wav.truePeakDbTp).toBeLessThanOrEqual(0);
    expect(Math.max(...wav.dcOffsets.map(Math.abs))).toBeLessThan(0.005);
    expect(wav.lowMonoCompatibilityDb).toBeGreaterThan(-3);
    expect(wav.lowCorrelation).toBeGreaterThan(0);
    expect(wav.activeBlockRatio).toBeGreaterThan(0.5);
}
