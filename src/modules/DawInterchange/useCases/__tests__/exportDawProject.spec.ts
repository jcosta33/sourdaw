import { beforeEach, describe, expect, it, vi } from 'vitest';

type BuiltClip = {
    bufferId?: string;
};

type BuiltTrack = {
    clips: BuiltClip[];
};

type BuiltProjectData = {
    data: {
        meta: { name: string };
        arrangement: { tracks: BuiltTrack[] };
    };
    missingBufferCount: number;
};

type GetCachedAudioBufferInput = {
    bufferId: string;
};

type SerializeProjectXmlInput = {
    project: {
        arrangement: {
            tracks: Array<{ clips: Array<{ bufferId?: string }> }>;
        };
    };
    audioPathByBufferId: Map<string, string>;
};

type SerializeMetadataXmlInput = {
    title: string;
    artist: string;
    comment: string;
};

type BuildDawProjectZipInput = {
    projectXml: string;
    metadataXml: string;
    audioFiles: Map<string, Uint8Array>;
};

const mocks = vi.hoisted(() => ({
    audio_buffer_to_wav: vi.fn<(buffer: AudioBuffer, bitDepth: 16 | 24 | 32) => Promise<ArrayBuffer>>(),
    build_daw_project_zip: vi.fn<(input: BuildDawProjectZipInput) => Uint8Array>(),
    build_project_data: vi.fn<(input?: { includeAudioBuffers?: boolean }) => Promise<BuiltProjectData | null>>(),
    get_cached_audio_buffer: vi.fn<(input: GetCachedAudioBufferInput) => AudioBuffer | null>(),
    serialize_metadata_xml: vi.fn<(input: SerializeMetadataXmlInput) => string>(),
    serialize_project_xml: vi.fn<(input: SerializeProjectXmlInput) => string>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.get_cached_audio_buffer,
}));

vi.mock('#/modules/AudioRendering/useCases', () => ({
    audioBufferToWav: mocks.audio_buffer_to_wav,
}));

vi.mock('#/modules/Project/useCases', () => ({
    buildProjectData: mocks.build_project_data,
}));

vi.mock('../buildDawProjectZip', () => ({
    buildDawProjectZip: mocks.build_daw_project_zip,
}));

vi.mock('../serializeMetadataXml', () => ({
    serializeMetadataXml: mocks.serialize_metadata_xml,
}));

vi.mock('../serializeProjectXml', () => ({
    serializeProjectXml: mocks.serialize_project_xml,
}));

function create_audio_buffer(): AudioBuffer {
    const channel_data = new Float32Array([0, 0.25, -0.25, 0]);
    return {
        copyFromChannel: (destination, _channel_number, start_in_channel = 0) => {
            destination.set(channel_data.subarray(start_in_channel, start_in_channel + destination.length));
        },
        copyToChannel: (source, _channel_number, start_in_channel = 0) => {
            channel_data.set(source, start_in_channel);
        },
        duration: channel_data.length / 48_000,
        getChannelData: () => channel_data,
        length: channel_data.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

function create_array_buffer(bytes: number[]): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

function create_built_project_data(): BuiltProjectData {
    return {
        data: {
            meta: { name: 'Song Name' },
            arrangement: {
                tracks: [
                    {
                        clips: [{ bufferId: 'drum loop/1?' }, { bufferId: 'missing:buffer' }],
                    },
                ],
            },
        },
        missingBufferCount: 0,
    };
}

describe('exportDawProject', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.build_project_data.mockResolvedValue(create_built_project_data());
        mocks.serialize_project_xml.mockReturnValue('<project />');
        mocks.serialize_metadata_xml.mockReturnValue('<metadata />');
        mocks.build_daw_project_zip.mockReturnValue(new Uint8Array([9, 8, 7]));
    });

    it('should read cached buffers through AudioEngine use cases and skip missing buffers', async () => {
        const { exportDawProject } = await import('../exportDawProject');
        const present_buffer = create_audio_buffer();
        mocks.get_cached_audio_buffer.mockImplementation(({ bufferId }) => {
            if (bufferId === 'drum loop/1?') {
                return present_buffer;
            }
            return null;
        });
        mocks.audio_buffer_to_wav.mockResolvedValue(create_array_buffer([1, 2, 3]));

        const result = await exportDawProject();

        expect(mocks.build_project_data).toHaveBeenCalledTimes(1);
        expect(mocks.build_project_data).toHaveBeenCalledWith({ includeAudioBuffers: false });
        expect(mocks.get_cached_audio_buffer).toHaveBeenNthCalledWith(1, { bufferId: 'drum loop/1?' });
        expect(mocks.get_cached_audio_buffer).toHaveBeenNthCalledWith(2, { bufferId: 'missing:buffer' });
        expect(mocks.audio_buffer_to_wav).toHaveBeenCalledTimes(1);
        expect(mocks.audio_buffer_to_wav).toHaveBeenCalledWith(present_buffer, 24);
        expect(mocks.serialize_project_xml).toHaveBeenCalledWith(
            expect.objectContaining({
                audioPathByBufferId: new Map([['drum loop/1?', 'audio/drum_loop_1_.wav']]),
            })
        );
        expect(mocks.serialize_project_xml.mock.calls[0]?.[0].project.arrangement.tracks[0]?.clips[0]?.bufferId).toBe(
            'drum loop/1?'
        );
        expect(mocks.serialize_metadata_xml).toHaveBeenCalledWith({ artist: '', comment: '', title: 'Song Name' });
        expect(mocks.build_daw_project_zip).toHaveBeenCalledWith({
            audioFiles: new Map([['audio/drum_loop_1_.wav', new Uint8Array([1, 2, 3])]]),
            metadataXml: '<metadata />',
            projectXml: '<project />',
        });
        // 'missing:buffer' was skipped, and the export now reports that rather
        // than dropping it silently (audit M-263).
        expect(result).toEqual({
            bytes: new Uint8Array([9, 8, 7]),
            fileName: 'Song_Name.dawproject',
            missingAudioCount: 1,
        });
    });
});
