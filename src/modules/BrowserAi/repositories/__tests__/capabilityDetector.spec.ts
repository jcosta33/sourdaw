import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const mocks = vi.hoisted(() => ({
    is_desktop: vi.fn(() => false),
}));

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: mocks.is_desktop,
}));

import { type CapabilityReport, type InferenceThroughput } from '../../models/CapabilityReport';
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
};

function install(throughput: InferenceThroughput): InstallOutput {
    const measure = vi.fn<MeasureThroughput>().mockResolvedValue(throughput);
    injectDependencies(detectCapabilities, { logger: create_logger_mock(), measureInferenceThroughput: measure });
    return { measure };
}

const valid_cached_report: CapabilityReport = {
    capability: 'supported',
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
        mocks.is_desktop.mockReturnValue(false);
        injectDependencies(detectCapabilities, {
            logger: create_logger_mock(),
            measureInferenceThroughput: vi
                .fn<MeasureThroughput>()
                .mockResolvedValue({ status: 'not-measured', reason: 'model-not-cached' }),
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

    it('should never consult the WebGPU adapter to grade the device', async () => {
        const { request_adapter } = install_supported_browser();
        install(measured(3));

        await detectCapabilities({ forceRefresh: true, measureInference: true });

        expect(request_adapter).not.toHaveBeenCalled();
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

    it('should return a valid cached report without fresh detection', async () => {
        install_supported_browser();
        const { measure } = install(measured(3));
        window.localStorage.setItem(storage_key, JSON.stringify(valid_cached_report));

        const report = await detectCapabilities();

        expect(report).toEqual(valid_cached_report);
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
        const { measure } = install(measured(3));

        const report = await detectCapabilities({ measureInference: true });

        expect(report.capability).toBe('unsupported-browser');
        expect(report.chromeVersion).toBe(133);
        expect(report.webGpuTier).toBe('not-measured');
        expect(report.inference).toEqual({ status: 'not-measured', reason: 'no-webgpu' });
        expect(measure).not.toHaveBeenCalled();
    });

    it('should mark the desktop app on macOS as an unsupported platform without probing', async () => {
        install_supported_browser();
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                userAgent: 'Mozilla/5.0 Chrome/133.0.0.0 Safari/537.36',
                platform: 'MacIntel',
                gpu: { requestAdapter: vi.fn() },
                storage: { getDirectory: vi.fn() },
            },
        });
        mocks.is_desktop.mockReturnValue(true);
        const { measure } = install(measured(3));

        const report = await detectCapabilities({ measureInference: true });

        expect(report.capability).toBe('unsupported-platform');
        expect(report.webGpuTier).toBe('not-measured');
        expect(measure).not.toHaveBeenCalled();
    });
});
