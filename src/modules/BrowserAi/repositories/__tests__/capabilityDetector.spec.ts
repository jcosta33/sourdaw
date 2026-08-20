import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type CapabilityReport, type InferenceThroughput } from '../../models/CapabilityReport';
import { type WebGpuProbeResult } from '../../models/WebGpuProbe';
import { detectCapabilities } from '../capabilityDetector';

const storage_key = 'sourdaw-browser-ai-capability';
const detected_at = 1_803_556_800_000;

type LoggerMock = {
    info: (message: string) => void;
    warn: (message: string) => void;
    debug: (message: string) => void;
};

function create_logger_mock(): LoggerMock {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    };
}

type RequestAdapter = () => Promise<unknown>;
type MeasureThroughput = () => Promise<InferenceThroughput>;
type ProbeWebGpu = () => Promise<WebGpuProbeResult>;

function measured(realtimeFactor: number): InferenceThroughput {
    return {
        status: 'measured',
        modelId: 'kokoro-82m-q8',
        executionProviders: ['webgpu', 'wasm'],
        audioSeconds: 4,
        elapsedSeconds: 4 / realtimeFactor,
        realtimeFactor,
    };
}

type InstallSupportedBrowserOutput = {
    request_adapter: Mock<RequestAdapter>;
};

/**
 * A device whose adapter comes back instantly. Under the old detector this alone
 * produced `webgpu-fast`; it must now produce nothing on its own.
 */
function install_supported_browser(): InstallSupportedBrowserOutput {
    const request_adapter = vi.fn<RequestAdapter>().mockResolvedValue({});
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            userAgent: 'Mozilla/5.0 Chrome/133.0.0.0 Safari/537.36',
            platform: 'Win32',
            gpu: { requestAdapter: request_adapter },
            storage: { getDirectory: vi.fn() },
        },
    });
    vi.spyOn(Date, 'now').mockReturnValue(detected_at);
    return { request_adapter };
}

type InstallOutput = {
    measure: Mock<MeasureThroughput>;
    probe: Mock<ProbeWebGpu>;
};

function install(throughput: InferenceThroughput, webGpu: WebGpuProbeResult = { status: 'supported' }): InstallOutput {
    const measure = vi.fn<MeasureThroughput>().mockResolvedValue(throughput);
    const probe = vi.fn<ProbeWebGpu>().mockResolvedValue(webGpu);
    injectDependencies(detectCapabilities, {
        logger: create_logger_mock(),
        measureInferenceThroughput: measure,
        probeWebGpuUsability: probe,
    });
    return { measure, probe };
}

const valid_cached_report: CapabilityReport = {
    capability: 'supported',
    webGpu: { status: 'supported' },
    webGpuTier: 'webgpu-fast',
    sharedArrayBuffer: true,
    opfsAvailable: true,
    chromeVersion: 133,
    inference: measured(2.5),
    detectedAt: 1_800_000_000_000,
};

describe('detectCapabilities', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
        injectDependencies(detectCapabilities, {
            logger: create_logger_mock(),
            measureInferenceThroughput: vi
                .fn<MeasureThroughput>()
                .mockResolvedValue({ status: 'not-measured', reason: 'model-not-cached' }),
            probeWebGpuUsability: vi.fn<ProbeWebGpu>().mockResolvedValue({ status: 'supported' }),
        });
    });

    // ── The defect this file exists to prevent regressing ────────────────────
    //
    // The tier used to be a function of `navigator.gpu.requestAdapter()` latency.
    // These three tests pin that it is now a function of measured inference
    // throughput and of nothing else.

    it('should report not-measured rather than a speed tier when throughput was not measured', async () => {
        install_supported_browser();
        install({ status: 'not-measured', reason: 'model-not-cached' });

        const report = await detectCapabilities({ forceRefresh: true, measureInference: true });

        expect(report.capability).toBe('supported');
        expect(report.webGpuTier).toBe('not-measured');
        expect(report.inference).toEqual({ status: 'not-measured', reason: 'model-not-cached' });
    });

    it('should use measured throughput rather than the admission probe to grade the device', async () => {
        install_supported_browser();
        const { probe } = install(measured(3));

        const report = await detectCapabilities({ forceRefresh: true, measureInference: true });

        expect(probe).toHaveBeenCalledTimes(1);
        expect(report.webGpuTier).toBe('webgpu-fast');
    });

    it('should grade the same device differently when its measured throughput differs', async () => {
        install_supported_browser();

        install(measured(2.5));
        const fast = await detectCapabilities({ forceRefresh: true, measureInference: true });

        install(measured(0.5));
        const slow = await detectCapabilities({ forceRefresh: true, measureInference: true });

        install(measured(0.05));
        const unusable = await detectCapabilities({ forceRefresh: true, measureInference: true });

        expect([fast.webGpuTier, slow.webGpuTier, unusable.webGpuTier]).toEqual([
            'webgpu-fast',
            'webgpu-slow',
            'unavailable',
        ]);
    });

    // ── Threshold boundaries ─────────────────────────────────────────────────

    it('should classify exactly real time as fast and just below it as slow', async () => {
        install_supported_browser();

        install(measured(1));
        const at_realtime = await detectCapabilities({ forceRefresh: true, measureInference: true });

        install(measured(0.999));
        const below_realtime = await detectCapabilities({ forceRefresh: true, measureInference: true });

        expect(at_realtime.webGpuTier).toBe('webgpu-fast');
        expect(below_realtime.webGpuTier).toBe('webgpu-slow');
    });

    it('should classify the usable floor as slow and just below it as unavailable', async () => {
        install_supported_browser();

        install(measured(0.2));
        const at_floor = await detectCapabilities({ forceRefresh: true, measureInference: true });

        install(measured(0.199));
        const below_floor = await detectCapabilities({ forceRefresh: true, measureInference: true });

        expect(at_floor.webGpuTier).toBe('webgpu-slow');
        expect(below_floor.webGpuTier).toBe('unavailable');
    });

    // ── Measurement is opt-in ────────────────────────────────────────────────

    it('should not run the expensive probe when measureInference is not requested', async () => {
        install_supported_browser();
        const { measure } = install(measured(3));

        const report = await detectCapabilities({ forceRefresh: true });

        expect(measure).not.toHaveBeenCalled();
        expect(report.inference).toEqual({ status: 'not-measured', reason: 'not-requested' });
        expect(report.webGpuTier).toBe('not-measured');
    });

    it('should carry a cached measured throughput through a platform-only refresh', async () => {
        install_supported_browser();
        const { measure } = install(measured(3));
        window.localStorage.setItem(storage_key, JSON.stringify(valid_cached_report));

        const report = await detectCapabilities({ forceRefresh: true });

        expect(measure).not.toHaveBeenCalled();
        expect(report.inference).toEqual(valid_cached_report.inference);
        expect(report.webGpuTier).toBe('webgpu-fast');
        expect(report.detectedAt).toBe(detected_at);
    });

    it('should not carry a cached not-measured reason forward as this run’s finding', async () => {
        install_supported_browser();
        install(measured(3));
        window.localStorage.setItem(
            storage_key,
            JSON.stringify({
                ...valid_cached_report,
                webGpuTier: 'not-measured',
                inference: { status: 'not-measured', reason: 'inference-failed' },
            })
        );

        const report = await detectCapabilities({ forceRefresh: true });

        expect(report.inference).toEqual({ status: 'not-measured', reason: 'not-requested' });
    });

    it('should re-run the probe even when a valid cached report exists', async () => {
        install_supported_browser();
        const { measure } = install(measured(0.4));
        window.localStorage.setItem(storage_key, JSON.stringify(valid_cached_report));

        const report = await detectCapabilities({ measureInference: true });

        expect(measure).toHaveBeenCalledTimes(1);
        expect(report.webGpuTier).toBe('webgpu-slow');
    });

    // ── Cache handling ───────────────────────────────────────────────────────

    it('should probe current hardware while reusing cached measured throughput', async () => {
        install_supported_browser();
        const { measure, probe } = install(measured(3));
        window.localStorage.setItem(storage_key, JSON.stringify(valid_cached_report));

        const report = await detectCapabilities();

        expect(probe).toHaveBeenCalledTimes(1);
        expect(measure).not.toHaveBeenCalled();
        expect(report.inference).toEqual(valid_cached_report.inference);
        expect(report.detectedAt).toBe(detected_at);
    });

    it('should replace cached support with the current unavailable WebGPU result', async () => {
        install_supported_browser();
        const { measure, probe } = install(measured(3), { status: 'unavailable', reason: 'device-unavailable' });
        window.localStorage.setItem(storage_key, JSON.stringify(valid_cached_report));

        const report = await detectCapabilities();

        expect(probe).toHaveBeenCalledTimes(1);
        expect(report.capability).toBe('unsupported-browser');
        expect(report.webGpu).toEqual({ status: 'unavailable', reason: 'device-unavailable' });
        expect(report.inference).toEqual({ status: 'not-measured', reason: 'no-webgpu' });
        expect(measure).not.toHaveBeenCalled();
    });

    it('should recover from cached WebGPU unavailability when the current probe succeeds', async () => {
        install_supported_browser();
        const { measure, probe } = install(measured(3));
        const cached_report: CapabilityReport = {
            ...valid_cached_report,
            capability: 'unsupported-browser',
            webGpu: { status: 'unavailable', reason: 'adapter-unavailable' },
            webGpuTier: 'not-measured',
            inference: { status: 'not-measured', reason: 'no-webgpu' },
        };
        window.localStorage.setItem(storage_key, JSON.stringify(cached_report));

        const report = await detectCapabilities();

        expect(probe).toHaveBeenCalledTimes(1);
        expect(report.capability).toBe('supported');
        expect(report.webGpu).toEqual({ status: 'supported' });
        expect(report.inference).toEqual({ status: 'not-measured', reason: 'not-requested' });
        expect(measure).not.toHaveBeenCalled();
    });

    it('should reject a cached report whose throughput shape is malformed', async () => {
        install_supported_browser();
        install(measured(3));
        window.localStorage.setItem(
            storage_key,
            JSON.stringify({
                ...valid_cached_report,
                inference: { status: 'measured', modelId: 'kokoro-82m-q8', realtimeFactor: 'fast' },
            })
        );

        const report = await detectCapabilities();

        expect(report.detectedAt).toBe(detected_at);
        expect(report.inference).toEqual({ status: 'not-measured', reason: 'not-requested' });
    });

    it('should reject a cached report carrying an unknown not-measured reason', async () => {
        install_supported_browser();
        install(measured(3));
        window.localStorage.setItem(
            storage_key,
            JSON.stringify({
                ...valid_cached_report,
                inference: { status: 'not-measured', reason: 'because-i-said-so' },
            })
        );

        const report = await detectCapabilities();

        expect(report.detectedAt).toBe(detected_at);
        expect(report.inference).toEqual({ status: 'not-measured', reason: 'not-requested' });
    });

    it('should discard a cached report from the property-only detector with no probe outcome', async () => {
        install_supported_browser();
        install(measured(3));
        const stale_report: Record<string, unknown> = { ...valid_cached_report };
        Reflect.deleteProperty(stale_report, 'webGpu');
        window.localStorage.setItem(storage_key, JSON.stringify(stale_report));

        const report = await detectCapabilities();

        expect(report.detectedAt).toBe(detected_at);
        expect(report.webGpu).toEqual({ status: 'supported' });
    });

    it('should discard a cached supported verdict with an unavailable probe outcome', async () => {
        install_supported_browser();
        install(measured(3));
        window.localStorage.setItem(
            storage_key,
            JSON.stringify({
                ...valid_cached_report,
                webGpu: { status: 'unavailable', reason: 'fallback-adapter' },
            })
        );

        const report = await detectCapabilities();

        expect(report.detectedAt).toBe(detected_at);
        expect(report.webGpu).toEqual({ status: 'supported' });
    });

    it('should discard a cached probe failure and rerun the WebGPU probe', async () => {
        install_supported_browser();
        const { probe } = install(measured(3));
        const cached_report: CapabilityReport = {
            ...valid_cached_report,
            capability: 'unsupported-browser',
            webGpu: { status: 'unavailable', reason: 'probe-failed' },
            webGpuTier: 'not-measured',
            inference: { status: 'not-measured', reason: 'no-webgpu' },
        };
        window.localStorage.setItem(storage_key, JSON.stringify(cached_report));

        const report = await detectCapabilities();

        expect(report.capability).toBe('supported');
        expect(report.webGpu).toEqual({ status: 'supported' });
        expect(report.detectedAt).toBe(detected_at);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('should ignore invalid cache shapes and run fresh detection', async () => {
        install_supported_browser();
        install(measured(3));
        window.localStorage.setItem(storage_key, JSON.stringify(['not-a-report']));

        const report = await detectCapabilities();

        expect(report.capability).toBe('supported');
        expect(report.detectedAt).toBe(detected_at);
    });

    it('should ignore invalid JSON and run fresh detection', async () => {
        install_supported_browser();
        install(measured(3));
        window.localStorage.setItem(storage_key, '{ not-json');

        const report = await detectCapabilities();

        expect(report.capability).toBe('supported');
        expect(report.detectedAt).toBe(detected_at);
    });

    it('should preserve the plain JSON cache write format', async () => {
        install_supported_browser();
        install(measured(1.75));

        const report = await detectCapabilities({ forceRefresh: true, measureInference: true });
        const cached = window.localStorage.getItem(storage_key);

        expect(cached).not.toBeNull();
        expect(JSON.parse(cached ?? '')).toEqual(report);
    });

    // ── Platform gates ───────────────────────────────────────────────────────

    it('should mark non-Chrome browsers as unsupported', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(detected_at);
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                userAgent:
                    'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
                platform: 'MacIntel',
                storage: { getDirectory: vi.fn() },
            },
        });
        const { measure } = install(measured(3));

        const report = await detectCapabilities({ measureInference: true });

        expect(report.capability).toBe('unsupported-browser');
        expect(report.chromeVersion).toBeNull();
        expect(report.webGpuTier).toBe('not-measured');
        expect(measure).not.toHaveBeenCalled();
    });

    it('should mark a Chrome browser without WebGPU as unsupported and name the reason', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(detected_at);
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                userAgent: 'Mozilla/5.0 Chrome/133.0.0.0 Safari/537.36',
                platform: 'Win32',
                storage: { getDirectory: vi.fn() },
            },
        });
        const { measure } = install(measured(3), { status: 'unavailable', reason: 'missing-surface' });

        const report = await detectCapabilities({ measureInference: true });

        expect(report.capability).toBe('unsupported-browser');
        expect(report.chromeVersion).toBe(133);
        expect(report.webGpu).toEqual({ status: 'unavailable', reason: 'missing-surface' });
        expect(report.webGpuTier).toBe('not-measured');
        expect(report.inference).toEqual({ status: 'not-measured', reason: 'no-webgpu' });
        expect(measure).not.toHaveBeenCalled();
    });

    it.each(['adapter-unavailable', 'fallback-adapter', 'device-unavailable'] as const)(
        'should reject the explicit WebGPU admission failure: %s',
        async (reason) => {
            install_supported_browser();
            const { measure } = install(measured(3), { status: 'unavailable', reason });

            const report = await detectCapabilities({ forceRefresh: true });

            expect(report.capability).toBe('unsupported-browser');
            expect(report.webGpu).toEqual({ status: 'unavailable', reason });
            expect(measure).not.toHaveBeenCalled();
        }
    );

    it('should fail closed without measuring inference when the WebGPU worker probe rejects', async () => {
        install_supported_browser();
        const measure = vi.fn<MeasureThroughput>().mockResolvedValue(measured(3));
        const logger = create_logger_mock();
        injectDependencies(detectCapabilities, {
            logger,
            measureInferenceThroughput: measure,
            probeWebGpuUsability: vi.fn<ProbeWebGpu>().mockRejectedValue(new Error('WebGPU probe worker timed out')),
        });

        const report = await detectCapabilities({ forceRefresh: true, measureInference: true });

        expect(report.capability).toBe('unsupported-browser');
        expect(report.webGpu).toEqual({ status: 'unavailable', reason: 'probe-failed' });
        expect(report.webGpuTier).toBe('not-measured');
        expect(report.inference).toEqual({ status: 'not-measured', reason: 'no-webgpu' });
        expect(measure).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
            '[BrowserAi] WebGPU usability probe failed — browser AI disabled'
        );
    });

    /**
     * macOS used to be gated out wholesale, because the desktop app ran on
     * WKWebView and WKWebView had no WebGPU. The desktop renderer is Chromium
     * now, so the host OS decides nothing here: the browser facts do.
     */
    it('should measure a macOS host on its browser facts rather than gating it out', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(detected_at);
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                userAgent: 'Mozilla/5.0 Chrome/133.0.0.0 Safari/537.36',
                platform: 'MacIntel',
                gpu: { requestAdapter: vi.fn() },
                storage: { getDirectory: vi.fn() },
            },
        });
        const { measure } = install(measured(3));

        const report = await detectCapabilities({ measureInference: true });

        expect(report.capability).toBe('supported');
        expect(report.webGpuTier).toBe('webgpu-fast');
        expect(measure).toHaveBeenCalled();
    });

    it('should discard a cached report naming a capability this build cannot produce', async () => {
        window.localStorage.setItem(
            storage_key,
            JSON.stringify({ ...valid_cached_report, capability: 'unsupported-platform' })
        );
        install_supported_browser();
        install(measured(3));

        const report = await detectCapabilities();

        expect(report.capability).toBe('supported');
        expect(report.detectedAt).toBe(detected_at);
    });
});
