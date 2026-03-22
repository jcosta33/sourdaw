/**
 * Repository: Web MIDI API I/O, device enumeration, and message routing.
 * Owns the MIDIAccess lifecycle, state, and real-time MIDI event dispatch.
 */
import { audioEngine } from '#/modules/AudioEngine/repositories/audioEngineInstance';
import { tauriInvoke, isTauri } from '#/helpers/tauriBridge';
import {
    getMidiStoreState,
    setMidiStoreState,
    getTrackStoreState,
    getMidiLearnState,
    createMidiNote,
} from '#/modules/Track/useCases/trackQueries';
import { getTransportStoreValue } from '#/modules/Transport/useCases/transportQueries';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { completeMidiLearn, handleMidiMessage as applyMidiMappings } from '#/modules/Track/useCases/midiLearnUseCases';
import { getSynthParamsForTrack, scheduleNote } from '#/modules/AudioEngine/useCases/builtinSynth';

export type MidiInputInfo = {
    id: string;
    name: string;
    manufacturer: string;
};

type TauriMidiDevice = { index: number; name: string };

let tauriMode = false;
let tauriEventUnlisten: (() => void) | null = null;

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

export function setMpeEnabled(enabled: boolean): void {
    mpeEnabled = enabled;
}

export function getMpeEnabled(): boolean {
    return mpeEnabled;
}

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

const webMidiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

let state: WebMidiState = {
    isSupported: webMidiSupported || isTauri(),
    inputs: [],
    selectedInputId: null,
};

const subscribers = new Set<Subscriber>();

function notify(): void {
    for (const fn of subscribers) {
        fn();
    }
}

function setState(next: Partial<WebMidiState>): void {
    state = { ...state, ...next };
    notify();
}

export function subscribe(callback: Subscriber): () => void {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
}

export function getSnapshot(): WebMidiState {
    return state;
}

function enumerateInputs(): MidiInputInfo[] {
    if (!midiAccess) {
        return [];
    }

    const entries = Array.from(midiAccess.inputs.values());
    return entries.map((input) => ({
        id: input.id,
        name: input.name ?? 'Unknown Device',
        manufacturer: input.manufacturer ?? 'Unknown',
    }));
}

function secondsToBeats(seconds: number, tempo: number): number {
    return (seconds * tempo) / 60;
}

function findActiveRecordingClip(trackId: string): string | null {
    const trackState = getTrackStoreState();
    const transport = getTransportStoreValue();
    if (!trackState || !transport) {
        return null;
    }

    const track = trackState.tracks.find((t) => t.id === trackId);
    if (!track) {
        return null;
    }

    const midiClips = track.clips.filter((c) => c.type === 'midi');
    if (midiClips.length === 0) {
        return null;
    }

    if (transport.isRecording && transport.overdubEnabled) {
        const ph = playheadPositionRef.current;
        const intersecting = midiClips.find((c) => ph >= c.startBeat && ph <= c.endBeat);
        if (intersecting) {
            return intersecting.id;
        }

        if (transport.isLooping && ph >= transport.loopStart && ph <= transport.loopEnd) {
            const loopClip = midiClips.find(
                (c) => c.startBeat >= transport.loopStart && c.endBeat <= transport.loopEnd
            );
            if (loopClip) {
                return loopClip.id;
            }
        }
    }

    return midiClips[midiClips.length - 1]!.id;
}

function handleNoteOn(channel: number, note: number, velocity: number): void {
    console.log(
        `[MIDI] noteOn: note=${note} vel=${velocity} targetTrack=${targetTrackId} ctxState=${audioEngine.context.state}`
    );
    if (velocity === 0) {
        handleNoteOff(channel, note);
        return;
    }

    if (!targetTrackId) {
        console.warn('[MIDI] No target track set — select a MIDI track first');
        return;
    }

    const transport = getTransportStoreValue();
    const engine = audioEngine;
    const now = engine.context.currentTime;

    const noteData: ActiveNoteData = {
        startTime: now,
        startBeat: transport ? playheadPositionRef.current : 0,
        channel,
    };
    activeNotes.set(note, noteData);

    if (mpeEnabled && channel >= 1) {
        channelToNote.set(channel, note);
    }

    const trackState = getTrackStoreState();
    const track = trackState?.tracks.find((t) => t.id === targetTrackId);
    const isArmed = track?.armed ?? false;
    const isRecording = transport?.isRecording ?? false;

    if (!(isRecording && isArmed)) {
        const strip = engine.ensureTrackStrip(targetTrackId);
        const synthParams = getSynthParamsForTrack(targetTrackId);
        // For live monitoring, start a note with a long duration; it'll be stopped on note-off
        const osc = scheduleNote(
            engine.context,
            strip.gainNode,
            note,
            engine.context.currentTime,
            60, // very long — stopped manually on note-off
            velocity,
            synthParams
        ) as OscillatorNode & { _env?: GainNode };
        noteData.osc = osc;
    }
}

function handleNoteOff(_channel: number, note: number): void {
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
        const synthParams = targetTrackId ? getSynthParamsForTrack(targetTrackId) : null;
        const releaseTime = synthParams?.release ?? 0.3;
        if (noteData.osc._env) {
            noteData.osc._env.gain.cancelScheduledValues(now);
            noteData.osc._env.gain.setTargetAtTime(0, now, releaseTime / 3);
        }
        try {
            noteData.osc.stop(now + releaseTime + 0.05);
        } catch {
            // already stopped
        }
    }

    if (!targetTrackId) {
        return;
    }

    const transport = getTransportStoreValue();
    const trackState = getTrackStoreState();
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

        const midiNote = createMidiNote(note, noteData.startBeat, Math.max(durationBeats, 0.0625), 100);

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

        const midiState = getMidiStoreState();
        if (!midiState) {
            return;
        }

        const existing = midiState.notesByClipId[clipId] ?? [];
        setMidiStoreState({
            ...midiState,
            notesByClipId: {
                ...midiState.notesByClipId,
                [clipId]: [...existing, midiNote],
            },
        });
    }
}

function handleCC(channel: number, cc: number, value: number): void {
    const learnState = getMidiLearnState();
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
}

function handleChannelPressure(channel: number, pressure: number): void {
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
}

function handlePitchBend(channel: number, lsb: number, msb: number): void {
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
}

function onMidiMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 2) {
        return;
    }

    const status = data[0]!;
    const messageType = status & 0xf0;
    const channel = status & 0x0f;

    console.log(
        `[MIDI] message: type=0x${messageType.toString(16)} ch=${channel} data=[${Array.from(data).join(',')}]`
    );

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
}

function attachInput(input: MIDIInput): void {
    if (activeInput) {
        activeInput.onmidimessage = null;
    }
    activeInput = input;
    input.onmidimessage = onMidiMessage;
}

function onStateChange(): void {
    const inputs = enumerateInputs();
    const selectedStillExists = inputs.some((i) => i.id === state.selectedInputId);

    if (!selectedStillExists && activeInput) {
        activeInput.onmidimessage = null;
        activeInput = null;
    }

    // Auto-attach first available device if none is selected
    if (!selectedStillExists && inputs.length > 0 && midiAccess) {
        const first = inputs[0]!;
        const input = midiAccess.inputs.get(first.id);
        if (input) {
            attachInput(input);
            console.log(`[MIDI] Auto-attached hot-plugged device: ${first.name}`);
            setState({ inputs, selectedInputId: first.id });
            return;
        }
    }

    setState({
        inputs,
        selectedInputId: selectedStillExists ? state.selectedInputId : null,
    });
}

export async function initWebMidi(): Promise<boolean> {
    if (!state.isSupported) {
        console.warn('[MIDI] MIDI not supported');
        return false;
    }

    // ── Try Web MIDI API first (works in Chrome) ─────────────────────
    if (webMidiSupported) {
        try {
            midiAccess = await navigator.requestMIDIAccess({ sysex: false });
            midiAccess.onstatechange = onStateChange;

            const inputs = enumerateInputs();
            console.log(
                `[MIDI] initWebMidi: found ${inputs.length} device(s):`,
                inputs.map((i) => i.name)
            );
            setState({ inputs });

            if (inputs.length > 0 && !state.selectedInputId) {
                const first = inputs[0]!;
                const input = midiAccess.inputs.get(first.id);
                if (input) {
                    attachInput(input);
                    setState({ selectedInputId: first.id });
                    console.log(`[MIDI] Auto-selected input: ${first.name}`);
                }
            }

            return true;
        } catch (error) {
            console.warn('[MIDI] Web MIDI failed, trying Tauri fallback:', error);
        }
    }

    // ── Tauri MIDI fallback (native midir via Rust) ──────────────────
    if (isTauri()) {
        try {
            tauriMode = true;
            const devices = (await tauriInvoke('list_midi_inputs')) as TauriMidiDevice[];
            const inputs: MidiInputInfo[] = devices.map((d) => ({
                id: String(d.index),
                name: d.name,
                manufacturer: 'System',
            }));
            console.log(
                `[MIDI] Tauri MIDI: found ${inputs.length} device(s):`,
                inputs.map((i) => i.name)
            );
            setState({ inputs, isSupported: true });

            if (inputs.length > 0 && !state.selectedInputId) {
                const first = inputs[0]!;
                await selectMidiInputTauri(Number(first.id));
                setState({ selectedInputId: first.id });
                console.log(`[MIDI] Tauri auto-selected input: ${first.name}`);
            }

            return true;
        } catch (error) {
            console.error('[MIDI] Tauri MIDI init failed:', error);
            setState({ isSupported: false });
            return false;
        }
    }

    setState({ isSupported: false });
    return false;
}

export function getAvailableMidiInputs(): MidiInputInfo[] {
    return state.inputs;
}

export function selectMidiInput(deviceId: string): void {
    if (tauriMode) {
        void selectMidiInputTauri(Number(deviceId));
        setState({ selectedInputId: deviceId });
        return;
    }

    if (!midiAccess) {
        return;
    }

    const input = midiAccess.inputs.get(deviceId);
    if (!input) {
        return;
    }

    attachInput(input);
    setState({ selectedInputId: deviceId });
}

async function selectMidiInputTauri(portIndex: number): Promise<void> {
    // Remove previous Tauri MIDI event listener
    if (tauriEventUnlisten) {
        tauriEventUnlisten();
        tauriEventUnlisten = null;
    }

    const portName = (await tauriInvoke('open_midi_input', { portIndex })) as string;
    console.log(`[MIDI] Tauri opened MIDI port: ${portName}`);

    // Listen for midi-message events from Rust
    const { tauriListen } = await import('#/helpers/tauriBridge');
    tauriEventUnlisten = (await tauriListen('midi-message', (event) => {
        const payload = event as { payload: { data: number[] } };
        const bytes = payload.payload.data;
        if (!bytes || bytes.length < 2) {
            return;
        }
        // Route through the same handler as Web MIDI
        const uint8 = new Uint8Array(bytes);
        onMidiMessage({ data: uint8 } as MIDIMessageEvent);
    })) as unknown as () => void;
}

export function setMidiInputTrack(trackId: string): void {
    targetTrackId = trackId;
}

export function startMidiLearnLegacy(callback: (cc: number, channel: number) => void): void {
    midiLearn.active = true;
    midiLearn.callback = callback;
}

export function stopMidiLearnLegacy(): void {
    midiLearn.active = false;
    midiLearn.callback = null;
}

export function resetMidiState(): void {
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
        const output = midiAccess.outputs.values().next().value;
        if (output) {
            for (let ch = 0; ch < 16; ch++) {
                output.send([MIDI_CC | ch, 120, 0]);
                output.send([MIDI_CC | ch, 121, 0]);
            }
        }
    }
}

export function destroyWebMidi(): void {
    if (activeInput) {
        activeInput.onmidimessage = null;
        activeInput = null;
    }

    // Close Tauri MIDI connection
    if (tauriMode) {
        if (tauriEventUnlisten) {
            tauriEventUnlisten();
            tauriEventUnlisten = null;
        }
        void tauriInvoke('close_midi_input').catch(() => {});
        tauriMode = false;
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
}
