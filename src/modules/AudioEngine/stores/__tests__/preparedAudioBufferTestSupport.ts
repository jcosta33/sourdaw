export function createAudioBuffer({ length, sampleRate }: { length: number; sampleRate: number }): AudioBuffer {
    const channels = Array.from({ length: 1 }, () => new Float32Array(length));
    return {
        copyFromChannel: (destination, channelNumber, startInChannel = 0) => {
            destination.set(channels[channelNumber]!.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source, channelNumber, startInChannel = 0) => {
            channels[channelNumber]!.set(source, startInChannel);
        },
        duration: length / sampleRate,
        getChannelData: (channelNumber) => channels[channelNumber]!,
        length,
        numberOfChannels: 1,
        sampleRate,
    };
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
        const request = indexedDB.open('sourdaw-audio', 2);
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
