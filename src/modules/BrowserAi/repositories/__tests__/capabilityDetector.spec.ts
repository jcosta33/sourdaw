import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const mocks = vi.hoisted(() => ({
    is_tauri: vi.fn(() => false),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.is_tauri,
}));

import { type CapabilityReport } from '../../models/CapabilityReport';
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

type InstallSupportedBrowserOutput = {
    request_adapter: Mock<RequestAdapter>;
};

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
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(12);
    return { request_adapter };
}

const valid_cached_report: CapabilityReport = {
    capability: 'supported',
    webGpuTier: 'webgpu-fast',
    sharedArrayBuffer: true,
    opfsAvailable: true,
    chromeVersion: 133,
    benchmarkMs: 12,
    detectedAt: 1_800_000_000_000,
};

describe('detectCapabilities', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
        mocks.is_tauri.mockReturnValue(false);
        injectDependencies(detectCapabilities, { logger: create_logger_mock() });
    });

    it('should return a valid cached report without fresh detection', async () => {
        const { request_adapter } = install_supported_browser();
        window.localStorage.setItem(storage_key, JSON.stringify(valid_cached_report));

        const report = await detectCapabilities();

        expect(report).toEqual(valid_cached_report);
        expect(request_adapter).not.toHaveBeenCalled();
    });

    it('should ignore malformed cached report fields and run fresh detection', async () => {
        const { request_adapter } = install_supported_browser();
        window.localStorage.setItem(
            storage_key,
            JSON.stringify({
                ...valid_cached_report,
                capability: 'maybe',
                benchmarkMs: 'fast',
            })
        );

        const report = await detectCapabilities();

        expect(report).toMatchObject({
            capability: 'supported',
            webGpuTier: 'webgpu-fast',
            opfsAvailable: true,
            chromeVersion: 133,
            benchmarkMs: 12,
            detectedAt: detected_at,
        });
        expect(request_adapter).toHaveBeenCalledTimes(1);
    });

    it('should ignore invalid cache shapes and run fresh detection', async () => {
        const { request_adapter } = install_supported_browser();
        window.localStorage.setItem(storage_key, JSON.stringify(['not-a-report']));

        const report = await detectCapabilities();

        expect(report.capability).toBe('supported');
        expect(report.webGpuTier).toBe('webgpu-fast');
        expect(report.detectedAt).toBe(detected_at);
        expect(request_adapter).toHaveBeenCalledTimes(1);
    });

    it('should ignore invalid JSON and run fresh detection', async () => {
        const { request_adapter } = install_supported_browser();
        window.localStorage.setItem(storage_key, '{ not-json');

        const report = await detectCapabilities();

        expect(report.capability).toBe('supported');
        expect(report.webGpuTier).toBe('webgpu-fast');
        expect(report.detectedAt).toBe(detected_at);
        expect(request_adapter).toHaveBeenCalledTimes(1);
    });

    it('should skip a valid cached report when forceRefresh is true', async () => {
        const { request_adapter } = install_supported_browser();
        window.localStorage.setItem(storage_key, JSON.stringify(valid_cached_report));

        const report = await detectCapabilities({ forceRefresh: true });

        expect(report.detectedAt).toBe(detected_at);
        expect(request_adapter).toHaveBeenCalledTimes(1);
    });

    it('should preserve the plain JSON cache write format', async () => {
        install_supported_browser();

        const report = await detectCapabilities({ forceRefresh: true });
        const cached = window.localStorage.getItem(storage_key);

        expect(cached).not.toBeNull();
        expect(JSON.parse(cached ?? '')).toEqual(report);
    });

    it('should mark non-Chrome browsers as unsupported', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(detected_at);
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
                platform: 'MacIntel',
                storage: { getDirectory: vi.fn() },
            },
        });

        const report = await detectCapabilities();

        expect(report.capability).toBe('unsupported-browser');
        expect(report.chromeVersion).toBeNull();
        expect(report.webGpuTier).toBe('unavailable');
    });

    it('should mark a Chrome browser without WebGPU as unsupported', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(detected_at);
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                userAgent: 'Mozilla/5.0 Chrome/133.0.0.0 Safari/537.36',
                platform: 'Win32',
                storage: { getDirectory: vi.fn() },
            },
        });

        const report = await detectCapabilities();

        expect(report.capability).toBe('unsupported-browser');
        expect(report.chromeVersion).toBe(133);
        expect(report.webGpuTier).toBe('unavailable');
    });
});
