import { vi } from 'vitest';

class TestAudioBuffer {
    readonly duration: number;
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;

    private readonly channels: Array<Float32Array<ArrayBuffer>>;

    constructor({ length, numberOfChannels = 1, sampleRate }: AudioBufferOptions) {
        this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
        this.duration = length / sampleRate;
        this.length = length;
        this.numberOfChannels = numberOfChannels;
        this.sampleRate = sampleRate;
    }

    copyFromChannel(destination: Float32Array<ArrayBuffer>, channelNumber: number, startInChannel = 0): void {
        destination.set(this.channels[channelNumber]!.subarray(startInChannel, startInChannel + destination.length));
    }

    copyToChannel(source: Float32Array<ArrayBuffer>, channelNumber: number, startInChannel = 0): void {
        this.channels[channelNumber]!.set(source, startInChannel);
    }

    getChannelData(channelNumber: number): Float32Array<ArrayBuffer> {
        return this.channels[channelNumber]!;
    }
}

export function installTestAudioBufferConstructor(): void {
    vi.stubGlobal('AudioBuffer', TestAudioBuffer);
}

export function createAudioBuffer({ length, sampleRate }: { length: number; sampleRate: number }): AudioBuffer {
    return new TestAudioBuffer({ length, numberOfChannels: 1, sampleRate });
}

export function createTestContext(createBuffer: BaseAudioContext['createBuffer']): BaseAudioContext {
    const unsupported = (member: string): never => {
        throw new Error(`BaseAudioContext.${member} is not implemented in this test double`);
    };
    return {
        createBuffer,
        currentTime: 0,
        onstatechange: null,
        sampleRate: 48_000,
        state: 'running',
        get audioWorklet(): AudioWorklet {
            return unsupported('audioWorklet');
        },
        get destination(): AudioDestinationNode {
            return unsupported('destination');
        },
        get listener(): AudioListener {
            return unsupported('listener');
        },
        createAnalyser: () => unsupported('createAnalyser'),
        createBiquadFilter: () => unsupported('createBiquadFilter'),
        createBufferSource: () => unsupported('createBufferSource'),
        createChannelMerger: () => unsupported('createChannelMerger'),
        createChannelSplitter: () => unsupported('createChannelSplitter'),
        createConstantSource: () => unsupported('createConstantSource'),
        createConvolver: () => unsupported('createConvolver'),
        createDelay: () => unsupported('createDelay'),
        createDynamicsCompressor: () => unsupported('createDynamicsCompressor'),
        createGain: () => unsupported('createGain'),
        createIIRFilter: () => unsupported('createIIRFilter'),
        createOscillator: () => unsupported('createOscillator'),
        createPanner: () => unsupported('createPanner'),
        createPeriodicWave: () => unsupported('createPeriodicWave'),
        createScriptProcessor: () => unsupported('createScriptProcessor'),
        createStereoPanner: () => unsupported('createStereoPanner'),
        createWaveShaper: () => unsupported('createWaveShaper'),
        decodeAudioData: () => unsupported('decodeAudioData'),
        addEventListener: () => unsupported('addEventListener'),
        removeEventListener: () => unsupported('removeEventListener'),
        dispatchEvent: () => unsupported('dispatchEvent'),
    };
}

export function openAudioDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('sourdaw-audio', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
}

export function encodeFloat32(values: number[]): string {
    const bytes = new Uint8Array(new Float32Array(values).buffer);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}
