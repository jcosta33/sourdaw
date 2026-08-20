import '@testing-library/jest-dom';
import { vi } from 'vitest';

const createStorageShim = (): Storage => {
    const values = new Map<string, string>();

    return {
        get length(): number {
            return values.size;
        },
        clear(): void {
            values.clear();
        },
        getItem(key: string): string | null {
            return values.get(String(key)) ?? null;
        },
        key(index: number): string | null {
            return [...values.keys()][index] ?? null;
        },
        removeItem(key: string): void {
            values.delete(String(key));
        },
        setItem(key: string, value: string): void {
            values.set(String(key), String(value));
        },
    };
};

const getWindowLocalStorage = (): Storage | null => {
    try {
        return window.localStorage ?? null;
    } catch {
        return null;
    }
};

const localStorageShim = getWindowLocalStorage() ?? createStorageShim();
// Guarded so `@vitest-environment node` specs (no DOM globals) can run under this setup.
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: localStorageShim,
    });
}
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageShim,
});

// Radix UI (Slider, etc.) uses ResizeObserver in layout effects — jsdom does not provide it.
globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
};

// JSDOM does not provide ImageData
if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
            this.data = new Uint8ClampedArray(width * height * 4);
        }
    } as any;
}

// Mock matchMedia for JSDOM
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(), // deprecated
            removeListener: vi.fn(), // deprecated
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
}

// Canvas2D used by `src/components/daw/visualizers/*` — jsdom does not implement drawing.
const gradientStub = {
    addColorStop: (): void => {},
};
const canvas2dStub = {
    canvas: {} as HTMLCanvasElement,
    createLinearGradient: () => gradientStub,
    createRadialGradient: () => gradientStub,
    createConicGradient: () => gradientStub,
    fillRect: (): void => {},
    clearRect: (): void => {},
    getImageData: () => ({ data: new Uint8ClampedArray(0) }),
    putImageData: (): void => {},
    createImageData: () => new ImageData(1, 1),
    setTransform: (): void => {},
    drawImage: (): void => {},
    save: (): void => {},
    fillText: (): void => {},
    restore: (): void => {},
    beginPath: (): void => {},
    moveTo: (): void => {},
    lineTo: (): void => {},
    closePath: (): void => {},
    stroke: (): void => {},
    strokeRect: (): void => {},
    translate: (): void => {},
    scale: (): void => {},
    rotate: (): void => {},
    arc: (): void => {},
    fill: (): void => {},
    measureText: () => ({ width: 0 }),
    transform: (): void => {},
    rect: (): void => {},
    clip: (): void => {},
    quadraticCurveTo: (): void => {},
    bezierCurveTo: (): void => {},
    strokeText: (): void => {},
    arcTo: (): void => {},
    ellipse: (): void => {},
    roundRect: (): void => {},
    resetTransform: (): void => {},
    setLineDash: (): void => {},
    getLineDash: () => [],
    lineDashOffset: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    shadowBlur: 0,
    shadowColor: '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'inherit',
} as unknown as CanvasRenderingContext2D;

if (typeof HTMLCanvasElement !== 'undefined') {
    // @ts-expect-error — jsdom stub covers only the '2d' path; the overloaded return type is intentionally incomplete
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, contextId: string) {
        if (contextId === '2d') {
            (canvas2dStub as { canvas: HTMLCanvasElement }).canvas = this;
            return canvas2dStub;
        }
        return null;
    };
}

// Pointer capture — used by CrustGainStrip and other drag surfaces; jsdom omits it.
if (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.setPointerCapture !== 'function') {
    HTMLElement.prototype.setPointerCapture = (): void => {};
}
if (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.releasePointerCapture !== 'function') {
    HTMLElement.prototype.releasePointerCapture = (): void => {};
}

// Web Audio — module singleton `createWebAudioEngine` instantiates on import; jsdom has no Audio APIs.
const DEFAULT_STUB_SAMPLE_RATE = 48_000;

function createMinimalBaseAudioContext(sampleRate: number = DEFAULT_STUB_SAMPLE_RATE): {
    state: AudioContextState;
    sampleRate: number;
    destination: AudioDestinationNode;
    audioWorklet: AudioWorklet;
    createGain: () => GainNode;
    createAnalyser: () => AnalyserNode;
    createChannelSplitter: () => ChannelSplitterNode;
    resume: () => Promise<void>;
    suspend: () => Promise<void>;
} {
    const stubNode = {
        connect: (): AudioNode => stubNode,
        disconnect: (): void => {},
    } as unknown as AudioNode;

    const createGain = (): GainNode =>
        ({
            gain: {
                value: 0,
                setValueAtTime: (): void => {},
                linearRampToValueAtTime: (): void => {},
                setTargetAtTime: (): void => {},
                cancelScheduledValues: (): void => {},
            },
            connect: (dest: AudioNode) => dest,
            disconnect: (): void => {},
        }) as unknown as GainNode;

    // `context` is inherited from AudioNode by every real AnalyserNode. Code
    // that maps FFT bins to frequencies reads `analyser.context.sampleRate`,
    // so a stub without it does not model the contract.
    const createAnalyser = (): AnalyserNode =>
        ({
            fftSize: 256,
            smoothingTimeConstant: 0.8,
            frequencyBinCount: 128,
            context,
            connect: (dest: AudioNode) => dest,
            disconnect: (): void => {},
            getFloatTimeDomainData: (data: Float32Array): void => {
                data.fill(0);
            },
            getFloatFrequencyData: (data: Float32Array): void => {
                data.fill(-100);
            },
        }) as unknown as AnalyserNode;

    // The master stereo analysis tap (createWebAudioEngine's constructor)
    // fans masterAnalyser's output through one of these into the L/R
    // analysers. Without a stub the constructor's `new AudioContext()` call
    // throws mid-setup and the whole singleton falls back to fallback mode.
    const createChannelSplitter = (): ChannelSplitterNode =>
        ({
            connect: (dest: AudioNode) => dest,
            disconnect: (): void => {},
        }) as unknown as ChannelSplitterNode;

    const context = {
        state: 'running' as AudioContextState,
        sampleRate,
        destination: stubNode as unknown as AudioDestinationNode,
        audioWorklet: { addModule: async (): Promise<void> => {} },
        createGain,
        createAnalyser,
        createChannelSplitter,
        resume: async (): Promise<void> => {},
        suspend: async (): Promise<void> => {},
    };
    return context;
}

globalThis.AudioContext = class AudioContextMock {
    constructor(options?: AudioContextOptions) {
        return createMinimalBaseAudioContext(options?.sampleRate);
    }
} as unknown as typeof AudioContext;

globalThis.OfflineAudioContext = class OfflineAudioContextMock {
    constructor(_channels?: number, _length?: number, sampleRate?: number) {
        return createMinimalBaseAudioContext(sampleRate);
    }
} as unknown as typeof OfflineAudioContext;

// AudioWorkletNode — factories and device code use `node instanceof AudioWorkletNode`
// to gate AudioParam scheduling. jsdom omits the class entirely, so the instanceof
// expression throws `ReferenceError: AudioWorkletNode is not defined`. Provide a
// minimal stub so tests that don't rely on real-worklet behaviour can load the code.
if (typeof globalThis.AudioWorkletNode === 'undefined') {
    globalThis.AudioWorkletNode = class AudioWorkletNodeStub {
        port = { postMessage: (): void => {}, onmessage: null };
        parameters = new Map<string, AudioParam>();
        connect(): AudioNode {
            return this as unknown as AudioNode;
        }
        disconnect(): void {}
    } as unknown as typeof AudioWorkletNode;
}

// Global mocks for Radix UI / Tooltip components to avoid "must be used within TooltipProvider" errors
vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: any) => children,
    TooltipTrigger: ({ children }: any) => children,
    TooltipContent: ({ children }: any) => children,
    TooltipProvider: ({ children }: any) => children,
}));
