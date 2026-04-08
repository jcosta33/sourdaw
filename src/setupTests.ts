import '@testing-library/jest-dom';

// Radix UI (Slider, etc.) uses ResizeObserver in layout effects — jsdom does not provide it.
globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
};

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
