import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { midiStore } from "#/modules/Track/stores/midiStore";
import { trackStore } from "#/modules/Track/stores/trackStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { createMidiNote } from "#/modules/Track/models/MidiNote";
import { midiLearnStore } from "#/modules/Track/stores/midiLearnStore";
import {
    completeMidiLearn,
    handleMidiMessage as applyMidiMappings,
} from "#/modules/Track/useCases/midiLearnUseCases";

export type MidiInputInfo = {
    id: string;
    name: string;
    manufacturer: string;
};

type MidiLearnState = {
    active: boolean;
    callback: ((cc: number, channel: number) => void) | null;
};

type WebMidiState = {
    isSupported: boolean;
    inputs: MidiInputInfo[];
    selectedInputId: string | null;
};

type Subscriber = () => void;

const MIDI_NOTE_ON = 0x90;
const MIDI_NOTE_OFF = 0x80;
const MIDI_CC = 0xb0;
const MIDI_PITCH_BEND = 0xe0;
const MIDI_CHANNEL_PRESSURE = 0xd0;
const MPE_SLIDE_CC = 74;

let midiAccess: MIDIAccess | null = null;
let activeInput: MIDIInput | null = null;
let targetTrackId: string | null = null;
let mpeEnabled = false;

export const setMpeEnabled = (enabled: boolean): void => {
    mpeEnabled = enabled;
};

export const getMpeEnabled = (): boolean => mpeEnabled;

type ActiveNoteData = {
    startTime: number;
    startBeat: number;
    channel: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    osc?: OscillatorNode & { _env?: GainNode };
};

const activeNotes = new Map<number, ActiveNoteData>();
const channelToNote = new Map<number, number>();

const midiLearn: MidiLearnState = {
    active: false,
    callback: null,
};

let state: WebMidiState = {
    isSupported: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator,
    inputs: [],
    selectedInputId: null,
};

const subscribers = new Set<Subscriber>();

const notify = (): void => {
    subscribers.forEach((fn) => fn());
};

const setState = (next: Partial<WebMidiState>): void => {
    state = { ...state, ...next };
    notify();
};

export const subscribe = (callback: Subscriber): (() => void) => {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
};

export const getSnapshot = (): WebMidiState => state;

const enumerateInputs = (): MidiInputInfo[] => {
    if (!midiAccess) return [];

    const entries = Array.from(midiAccess.inputs.values());
    return entries.map((input) => ({
        id: input.id,
        name: input.name ?? "Unknown Device",
        manufacturer: input.manufacturer ?? "Unknown",
    }));
};

const midiToFrequency = (note: number): number => {
    return 440 * Math.pow(2, (note - 69) / 12);
};

const secondsToBeats = (seconds: number, tempo: number): number => {
    return (seconds * tempo) / 60;
};

const findActiveRecordingClip = (trackId: string): string | null => {
    const trackState = trackStore.value;
    if (!trackState) return null;

    const track = trackState.tracks.find((t) => t.id === trackId);
    if (!track) return null;

    const midiClips = track.clips.filter((c) => c.type === "midi");
    return midiClips.length > 0 ? midiClips[midiClips.length - 1]!.id : null;
};

const handleNoteOn = (channel: number, note: number, velocity: number): void => {
    if (velocity === 0) {
        handleNoteOff(channel, note);
        return;
    }

    if (!targetTrackId) {
        return;
    }

    const transport = transportStore.value;
    const engine = audioEngine;
    const now = engine.context.currentTime;

    const noteData: ActiveNoteData = {
        startTime: now,
        startBeat: transport ? transport.playheadPosition : 0,
        channel,
    };
    activeNotes.set(note, noteData);

    if (mpeEnabled && channel >= 1) {
        channelToNote.set(channel, note);
    }

    const trackState = trackStore.value;
    const track = trackState?.tracks.find((t) => t.id === targetTrackId);
    const isArmed = track?.armed ?? false;
    const isRecording = transport?.isRecording ?? false;

    if (!(isRecording && isArmed)) {
        const strip = engine.ensureTrackStrip(targetTrackId);
        const freq = midiToFrequency(note);
        const gain = (velocity / 127) * 0.5;

        const osc = engine.context.createOscillator() as OscillatorNode & { _env?: GainNode };
        const env = engine.context.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        env.gain.setValueAtTime(gain, now);
        osc.connect(env);
        env.connect(strip.gainNode);
        osc.start(now);

        osc._env = env;
        noteData.osc = osc;
    }
};

const handleNoteOff = (_channel: number, note: number): void => {
    const noteData = activeNotes.get(note);
    if (!noteData) {
        return;
    }

    activeNotes.delete(note);

    if (mpeEnabled) {
        channelToNote.delete(noteData.channel);
    }

    if (noteData.osc) {
        const now = audioEngine.context.currentTime;
        if (noteData.osc._env) {
            noteData.osc._env.gain.setTargetAtTime(0, now, 0.02);
        }
        try {
            noteData.osc.stop(now + 0.05);
        } catch {
            // already stopped
        }
    }

    if (!targetTrackId) {
        return;
    }

    const transport = transportStore.value;
    const trackState = trackStore.value;
    const track = trackState?.tracks.find((t) => t.id === targetTrackId);
    const isArmed = track?.armed ?? false;
    const isRecording = transport?.isRecording ?? false;

    if (isRecording && isArmed) {
        const clipId = findActiveRecordingClip(targetTrackId);
        if (!clipId) {
            return;
        }

        const tempo = transport?.tempo ?? 120;
        const durationSeconds = audioEngine.context.currentTime - noteData.startTime;
        const durationBeats = secondsToBeats(durationSeconds, tempo);

        const midiNote = createMidiNote(
            note,
            noteData.startBeat,
            Math.max(durationBeats, 0.0625),
            100,
        );

        if (mpeEnabled) {
            if (noteData.pressure !== undefined) {
                midiNote.pressure = noteData.pressure;
            }
            if (noteData.slide !== undefined) {
                midiNote.slide = noteData.slide;
            }
            if (noteData.pitchBend !== undefined) {
                midiNote.pitchBend = noteData.pitchBend;
            }
        }

        const midiState = midiStore.value;
        if (!midiState) {
            return;
        }

        const existing = midiState.notesByClipId[clipId] ?? [];
        midiStore.set({
            ...midiState,
            notesByClipId: {
                ...midiState.notesByClipId,
                [clipId]: [...existing, midiNote],
            },
        });
    }
};

const handleCC = (channel: number, cc: number, value: number): void => {
    const learnState = midiLearnStore.value;
    if (learnState?.isLearning && learnState.learningTarget) {
        completeMidiLearn(channel, cc);
        return;
    }

    if (mpeEnabled && cc === MPE_SLIDE_CC && channel >= 1) {
        const noteForChannel = channelToNote.get(channel);
        if (noteForChannel !== undefined) {
            const noteData = activeNotes.get(noteForChannel);
            if (noteData) {
                noteData.slide = value;
            }
        }
        return;
    }

    applyMidiMappings(channel, cc, value);

    if (!targetTrackId) {
        return;
    }

    if (cc === 7) {
        audioEngine.setTrackGain(targetTrackId, value / 127);
    } else if (cc === 10) {
        audioEngine.setTrackPan(targetTrackId, ((value / 127) * 2 - 1) * 50);
    }
};

const handleChannelPressure = (channel: number, pressure: number): void => {
    if (!mpeEnabled || channel < 1) {
        return;
    }

    const noteForChannel = channelToNote.get(channel);
    if (noteForChannel === undefined) {
        return;
    }

    const noteData = activeNotes.get(noteForChannel);
    if (noteData) {
        noteData.pressure = pressure;
    }
};

const handlePitchBend = (channel: number, lsb: number, msb: number): void => {
    if (!mpeEnabled || channel < 1) {
        return;
    }

    const noteForChannel = channelToNote.get(channel);
    if (noteForChannel === undefined) {
        return;
    }

    const noteData = activeNotes.get(noteForChannel);
    if (noteData) {
        noteData.pitchBend = ((msb << 7) | lsb) - 8192;
    }
};

const onMidiMessage = (event: MIDIMessageEvent): void => {
    const data = event.data;
    if (!data || data.length < 2) return;

    const status = data[0]!;
    const messageType = status & 0xf0;
    const channel = status & 0x0f;

    switch (messageType) {
        case MIDI_NOTE_ON:
            handleNoteOn(channel, data[1]!, data[2] ?? 0);
            break;
        case MIDI_NOTE_OFF:
            handleNoteOff(channel, data[1]!);
            break;
        case MIDI_CC:
            handleCC(channel, data[1]!, data[2] ?? 0);
            break;
        case MIDI_CHANNEL_PRESSURE:
            handleChannelPressure(channel, data[1]!);
            break;
        case MIDI_PITCH_BEND:
            handlePitchBend(channel, data[1]!, data[2] ?? 0);
            break;
    }
};

const attachInput = (input: MIDIInput): void => {
    if (activeInput) {
        activeInput.onmidimessage = null;
    }
    activeInput = input;
    input.onmidimessage = onMidiMessage;
};

const onStateChange = (): void => {
    const inputs = enumerateInputs();
    const selectedStillExists = inputs.some((i) => i.id === state.selectedInputId);

    setState({
        inputs,
        selectedInputId: selectedStillExists ? state.selectedInputId : null,
    });

    if (!selectedStillExists && activeInput) {
        activeInput.onmidimessage = null;
        activeInput = null;
    }
};

export const initWebMidi = async (): Promise<boolean> => {
    if (!state.isSupported) return false;

    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        midiAccess.onstatechange = onStateChange;

        const inputs = enumerateInputs();
        setState({ inputs });

        if (inputs.length > 0 && !state.selectedInputId) {
            const first = inputs[0]!;
            const input = midiAccess.inputs.get(first.id);
            if (input) {
                attachInput(input);
                setState({ selectedInputId: first.id });
            }
        }

        return true;
    } catch {
        setState({ isSupported: false });
        return false;
    }
};

export const getAvailableMidiInputs = (): MidiInputInfo[] => {
    return state.inputs;
};

export const selectMidiInput = (deviceId: string): void => {
    if (!midiAccess) return;

    const input = midiAccess.inputs.get(deviceId);
    if (!input) return;

    attachInput(input);
    setState({ selectedInputId: deviceId });
};

export const setMidiInputTrack = (trackId: string): void => {
    targetTrackId = trackId;
};

export const startMidiLearnLegacy = (callback: (cc: number, channel: number) => void): void => {
    midiLearn.active = true;
    midiLearn.callback = callback;
};

export const stopMidiLearnLegacy = (): void => {
    midiLearn.active = false;
    midiLearn.callback = null;
};

export const resetMidiState = (): void => {
    for (const [note, noteData] of activeNotes) {
        if (noteData.osc) {
            const now = audioEngine.context.currentTime;
            if (noteData.osc._env) {
                noteData.osc._env.gain.setTargetAtTime(0, now, 0.005);
            }
            try {
                noteData.osc.stop(now + 0.02);
            } catch {
                // already stopped
            }
        }
        void note;
    }
    activeNotes.clear();
    channelToNote.clear();

    if (activeInput && midiAccess) {
        const output = midiAccess.outputs.values().next().value as MIDIOutput | undefined;
        if (output) {
            for (let ch = 0; ch < 16; ch++) {
                output.send([MIDI_CC | ch, 120, 0]);
                output.send([MIDI_CC | ch, 121, 0]);
            }
        }
    }
};

export const destroyWebMidi = (): void => {
    if (activeInput) {
        activeInput.onmidimessage = null;
        activeInput = null;
    }

    for (const noteData of activeNotes.values()) {
        if (noteData.osc) {
            try {
                noteData.osc.stop();
            } catch {
                // already stopped
            }
        }
    }
    activeNotes.clear();
    channelToNote.clear();

    if (midiAccess) {
        midiAccess.onstatechange = null;
        midiAccess = null;
    }

    midiLearn.active = false;
    midiLearn.callback = null;
    targetTrackId = null;

    setState({
        inputs: [],
        selectedInputId: null,
    });
};
