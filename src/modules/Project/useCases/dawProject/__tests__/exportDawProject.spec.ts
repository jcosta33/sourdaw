import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoreMock<TValue> = {
    value: TValue;
};

type ExportClip = {
    audioBufferId?: string;
};

type ExportTrack = {
    alternatives: [];
    clips: ExportClip[];
};

type TrackState = {
    tracks: ExportTrack[];
    selectedTrackId: string | null;
};

type TransportState = {
    tempo: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
    loopStart: number;
    loopEnd: number;
    isLooping: boolean;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    punchInEnabled: boolean;
    punchInBeat: number;
    punchOutBeat: number;
    countInEnabled: boolean;
    countInBars: number;
    preRollEnabled: boolean;
    preRollBars: number;
    masterGain: number;
};

type MidiState = {
    notesByClipId: {
        clip_midi?: {
            id: string;
            pitch: number;
            startBeat: number;
            duration: number;
            velocity: number;
            probability?: number;
            pressure?: number;
            slide?: number;
            pitchBend?: number;
        }[];
    };
    ccByClipId: {
        clip_midi?: unknown[];
    };
    pitchBendByClipId: {
        clip_midi?: unknown[];
    };
};

type ProjectState = {
    name: string;
    createdAt: number;
    keyRoot: number;
    scaleName: string;
    tuning: {
        name: string;
        frequencies: number[];
    };
};

type ArrangementState = {
    arrangements: {
        id: string;
        name: string;
        tracks: TrackState;
        automation: { lanes: unknown[] };
        midi: MidiState;
    }[];
    activeArrangementId: string;
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

const mocks = vi.hoisted(() => {
    function create_store_mock<TValue>(value: TValue): StoreMock<TValue> {
        return { value };
    }

    return {
        arrangement_store: create_store_mock<ArrangementState | null>(null),
        audio_buffer_to_wav: vi.fn<(buffer: AudioBuffer, bitDepth: 16 | 24 | 32) => Promise<ArrayBuffer>>(),
        automation_store: create_store_mock<{ lanes: unknown[] } | null>({ lanes: [] }),
        build_daw_project_zip: vi.fn<(input: BuildDawProjectZipInput) => Uint8Array>(),
        get_cached_audio_buffer: vi.fn<(input: GetCachedAudioBufferInput) => AudioBuffer | null>(),
        marker_store: create_store_mock<{ markers: unknown[] } | null>({ markers: [] }),
        midi_store: create_store_mock<MidiState | null>(null),
        project_store: create_store_mock<ProjectState | null>(null),
        serialize_metadata_xml: vi.fn<(input: SerializeMetadataXmlInput) => string>(),
        serialize_project_xml: vi.fn<(input: SerializeProjectXmlInput) => string>(),
        sync_current_arrangement_to_store: vi.fn(),
        take_lane_store: create_store_mock<null>(null),
        tempo_map_store: create_store_mock<null>(null),
        time_signature_map_store: create_store_mock<null>(null),
        track_store: create_store_mock<TrackState | null>(null),
        transport_store: create_store_mock<TransportState | null>(null),
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: mocks.marker_store,
    takeLaneStore: mocks.take_lane_store,
    trackStore: mocks.track_store,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioBufferToWav: mocks.audio_buffer_to_wav,
    getCachedAudioBuffer: mocks.get_cached_audio_buffer,
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: mocks.automation_store,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: mocks.midi_store,
}));

vi.mock('#/modules/Transport/stores', () => ({
    tempoMapStore: mocks.tempo_map_store,
    timeSignatureMapStore: mocks.time_signature_map_store,
    transportStore: mocks.transport_store,
}));

vi.mock('../../../stores/arrangementStore', () => ({
    arrangementStore: mocks.arrangement_store,
}));

vi.mock('../../../stores/projectStore', () => ({
    projectStore: mocks.project_store,
}));

vi.mock('../../arrangement/syncCurrentArrangementToStore', () => ({
    syncCurrentArrangementToStore: mocks.sync_current_arrangement_to_store,
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

function reset_store_values(): void {
    mocks.track_store.value = {
        selectedTrackId: null,
        tracks: [
            {
                alternatives: [],
                clips: [{ audioBufferId: 'drum loop/1?' }, { audioBufferId: 'missing:buffer' }],
            },
        ],
    };
    mocks.transport_store.value = {
        countInBars: 1,
        countInEnabled: false,
        isLooping: false,
        loopEnd: 8,
        loopStart: 0,
        masterGain: 0.8,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        preRollBars: 1,
        preRollEnabled: false,
        punchInBeat: 0,
        punchInEnabled: false,
        punchOutBeat: 0,
        tempo: 120,
        timeSignatureDenominator: 4,
        timeSignatureNumerator: 4,
    };
    mocks.midi_store.value = {
        ccByClipId: {},
        notesByClipId: {},
        pitchBendByClipId: {},
    };
    mocks.project_store.value = {
        createdAt: 1,
        keyRoot: 0,
        name: 'Song Name',
        scaleName: 'major',
        tuning: { frequencies: [], name: 'Equal Temperament' },
    };
    mocks.arrangement_store.value = {
        activeArrangementId: 'arrangement-1',
        arrangements: [
            {
                id: 'arrangement-1',
                name: 'Arrangement',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
    };
}

describe('exportDawProject', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        reset_store_values();
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
        expect(mocks.build_daw_project_zip).toHaveBeenCalledWith({
            audioFiles: new Map([['audio/drum_loop_1_.wav', new Uint8Array([1, 2, 3])]]),
            metadataXml: '<metadata />',
            projectXml: '<project />',
        });
        expect(result).toEqual({ bytes: new Uint8Array([9, 8, 7]), fileName: 'Song_Name.dawproject' });
    });
});
