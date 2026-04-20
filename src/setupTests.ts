import '@testing-library/jest-dom';
import { vi } from 'vitest';

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

// @ts-expect-error — jsdom stub covers only the '2d' path; the overloaded return type is intentionally incomplete
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, contextId: string) {
    if (contextId === '2d') {
        (canvas2dStub as { canvas: HTMLCanvasElement }).canvas = this;
        return canvas2dStub;
    }
    return null;
};

// Pointer capture — used by CrustGainStrip and other drag surfaces; jsdom omits it.
if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
    HTMLElement.prototype.setPointerCapture = (): void => {};
}
if (typeof HTMLElement.prototype.releasePointerCapture !== 'function') {
    HTMLElement.prototype.releasePointerCapture = (): void => {};
}

// Web Audio — module singleton `createWebAudioEngine` instantiates on import; jsdom has no Audio APIs.
function createMinimalBaseAudioContext(): {
    state: AudioContextState;
    destination: AudioDestinationNode;
    audioWorklet: AudioWorklet;
    createGain: () => GainNode;
    createAnalyser: () => AnalyserNode;
    resume: () => Promise<void>;
    suspend: () => Promise<void>;
} {
    const stubNode = {
        connect: (): AudioNode => stubNode as unknown as AudioNode,
        disconnect: (): void => {},
    } as unknown as AudioNode;

    const createGain = (): GainNode =>
        ({
            gain: { value: 0, setValueAtTime: (): void => {}, linearRampToValueAtTime: (): void => {} },
            connect: (dest: AudioNode) => dest,
            disconnect: (): void => {},
        }) as unknown as GainNode;

    const createAnalyser = (): AnalyserNode =>
        ({
            fftSize: 256,
            smoothingTimeConstant: 0.8,
            frequencyBinCount: 128,
            connect: (dest: AudioNode) => dest,
            disconnect: (): void => {},
            getFloatTimeDomainData: (data: Float32Array): void => {
                data.fill(0);
            },
            getFloatFrequencyData: (data: Float32Array): void => {
                data.fill(-100);
            },
        }) as unknown as AnalyserNode;

    return {
        state: 'running',
        destination: stubNode as unknown as AudioDestinationNode,
        audioWorklet: { addModule: async (): Promise<void> => {} } as unknown as AudioWorklet,
        createGain,
        createAnalyser,
        resume: async (): Promise<void> => {},
        suspend: async (): Promise<void> => {},
    };
}

globalThis.AudioContext = class AudioContextMock {
    constructor(_options?: AudioContextOptions) {
        return createMinimalBaseAudioContext() as unknown as AudioContext;
    }
} as unknown as typeof AudioContext;

globalThis.OfflineAudioContext = class OfflineAudioContextMock {
    constructor(_channels?: number, _length?: number, _sampleRate?: number) {
        return createMinimalBaseAudioContext() as unknown as OfflineAudioContext;
    }
} as unknown as typeof OfflineAudioContext;

// Global mocks for Radix UI / Tooltip components to avoid "must be used within TooltipProvider" errors
vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: any) => children,
    TooltipTrigger: ({ children }: any) => children,
    TooltipContent: ({ children }: any) => children,
    TooltipProvider: ({ children }: any) => children,
}));

// Global mocks for core workspace hooks to avoid "cannot read property of undefined" in basic render tests
vi.mock('#/modules/Workspace/presentations/hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [],
        selectedTrackId: null,
        buses: [],
    })),
}));

vi.mock('#/modules/Workspace/presentations/hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(() => ({
        mode: 'arrange',
        channelStripWidth: 'normal',
        isSidebarOpen: true,
        isMixerOpen: true,
        isInspectorOpen: false,
    })),
}));

// Global useStore mock. Historically returned a hardcoded blob covering
// the shapes of a handful of specific stores; the branch-2 work that
// moved many components from `store.value?.x` render-time reads to
// proper `useStore` subscriptions (§52.1, §142.1, §195.3, §197.1,
// §201.1, §202.1, §211.1, …) exposed several fields this mock never
// returned (activeSlots, groups, tracks, selectedTrackId, envelopes,
// routes, markers, sections, …). The right long-term fix is to drop
// this global and let each test mock useStore explicitly, but that's a
// 37-file cleanup for another session; for now, expand the blob with
// the missing fields so the reactive-store conversions don't fail
// render-time subscription tests.
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        // MIDI learn store
        mappings: [],
        isLearning: false,
        learningTarget: null,
        // Levain patch (wrapped in a Proxy to cover arbitrary accesses)
        patch: new Proxy(
            {
                enabled: true,
                processActive: true,
                instrumentId: 'violin-1',
                instrumentFamily: 'Strings',
                articulations: [],
                currentArticulation: 'long',
                legato: { enabled: true },
                expression: { dynamics: 0.5, vibrato: 0.5 },
                humanize: { amount: 0.1 },
                micPositions: [],
                macros: [0, 0, 0, 0],
                macroLabels: ['M1', 'M2', 'M3', 'M4'],
                releaseTriggers: { enabled: true, dynamicScale: true },
            },
            {
                get(target: any, prop: string | symbol) {
                    if (prop in target) {
                        return target[prop];
                    }
                    if (typeof prop === 'string') {
                        if (prop === 'topology') {
                            return 'glue';
                        }
                        if (prop === 'algorithm') {
                            return 'delay';
                        }
                        if (prop === 'filter') {
                            return { type: 'lowpass', cutoff: 1000, resonance: 0 };
                        }
                        if (
                            prop === 'pads' ||
                            prop === 'nodes' ||
                            prop === 'channels' ||
                            prop === 'tracks' ||
                            prop === 'prePedals' ||
                            prop === 'postPedals' ||
                            prop === 'micPositions' ||
                            prop === 'macros' ||
                            prop === 'macroLabels' ||
                            prop === 'articulations' ||
                            prop === 'devices' ||
                            prop === 'sends' ||
                            prop === 'clips'
                        ) {
                            return [];
                        }
                        if (prop.includes('Id') || prop === 'name' || prop === 'label' || prop === 'category') {
                            return 'mock';
                        }
                    }
                    return 0;
                },
            }
        ),
        engineReady: true,
        activeVoices: 0,
        sampleLoadProgress: null,
        currentArticulationDisplay: 'Long',
        uiLevel: 1,
        peakL: 0,
        peakR: 0,
        activePresetId: null,
        attack: 0.1,
        decay: 0.2,
        sustain: 0.5,
        release: 0.3,
        pads: [],
        channels: [],
        past: [],
        future: [],
        // Reactive-store conversions landed in branch 2 read these fields
        // directly via useStore. Adding them to the shared blob so that
        // components migrated from render-time store.value? reads to
        // proper subscriptions don't crash existing render tests.
        activeSlots: {}, // SessionLaunchState (§142.1 SessionView)
        tracks: [], // TrackStoreState (§52.1 GrandBoulePanel, §195.3 WaveformEditor)
        selectedTrackId: null, // TrackStoreState
        groups: [], // VcaGroupState (§202.1 TrackVcaSection)
        routes: [], // SidechainStoreState (§201.1 RoutingGraph)
        envelopes: {}, // GainEnvelopeStoreState (§197.1 ClipGainEnvelopeSection)
        markers: [], // MarkerStoreState (§211.1 NearbyMarkerColorMenu)
        sections: [], // MarkerStoreState
    })),
}));
