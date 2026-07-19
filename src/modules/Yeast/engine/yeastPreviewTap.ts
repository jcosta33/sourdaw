import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastPreviewEvent, YeastPreviewSnapshot } from '../models/YeastPreviewSnapshot';

export const YEAST_PREVIEW_CAPACITY = 512;

type MutableYeastPreviewEvent = {
    -readonly [Key in keyof YeastPreviewEvent]: YeastPreviewEvent[Key];
};

type PublishYeastPreviewEventsInput = {
    events: readonly MidiEvent[];
    blockStartSamples: number;
    transport: TransportInfo;
    processorId: string;
    bypassed: boolean;
};

type NoteOnKind = Extract<MidiEvent['kind'], { type: 'noteOn' }>;
type NoteOffKind = Extract<MidiEvent['kind'], { type: 'noteOff' }>;

const MIDI_NOTE_KEY_COUNT = 16 * 128;
const NO_PENDING_SLOT = -1;

function createPreviewSlot(): MutableYeastPreviewEvent {
    return {
        beatTime: 0,
        durationBeats: 0,
        pitch: 0,
        velocity: 0,
        probability: null,
        realized: true,
        processorId: '',
        bypassed: false,
    };
}

export class YeastPreviewTap {
    private readonly storage: MutableYeastPreviewEvent[];
    private readonly noteOnSamples = new Float64Array(YEAST_PREVIEW_CAPACITY);
    private readonly pendingHead = new Int16Array(MIDI_NOTE_KEY_COUNT);
    private readonly pendingTail = new Int16Array(MIDI_NOTE_KEY_COUNT);
    private readonly pendingEpoch = new Uint32Array(MIDI_NOTE_KEY_COUNT);
    private readonly pendingNext = new Int16Array(YEAST_PREVIEW_CAPACITY);
    private readIndex = 0;
    private size = 0;
    private droppedEvents = 0;
    private epoch = 0;
    private enabled = false;

    constructor() {
        this.storage = Array.from({ length: YEAST_PREVIEW_CAPACITY }, createPreviewSlot);
    }

    setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) {
            return;
        }
        this.enabled = enabled;
        this.readIndex = 0;
        this.size = 0;
        this.droppedEvents = 0;
    }

    publish(input: PublishYeastPreviewEventsInput): void {
        if (!this.enabled) {
            return;
        }

        const samplesPerBeat = (input.transport.sampleRate * 60) / input.transport.bpm;
        if (!Number.isFinite(samplesPerBeat) || samplesPerBeat <= 0) {
            return;
        }

        this.startPairingEpoch();
        for (let index = 0; index < input.events.length; index++) {
            const event = input.events[index]!;
            if (event.kind.type === 'noteOn') {
                this.publishNoteOn(
                    event.timeSamples,
                    event.kind,
                    input.blockStartSamples,
                    samplesPerBeat,
                    input.transport.ppqPosition,
                    input.processorId,
                    input.bypassed
                );
                continue;
            }
            if (event.kind.type === 'noteOff') {
                this.pairNoteOff(event.timeSamples, event.kind, samplesPerBeat);
            }
        }
    }

    read(): YeastPreviewSnapshot {
        const events: YeastPreviewEvent[] = [];
        for (let index = 0; index < this.size; index++) {
            const slot = this.storage[(this.readIndex + index) % YEAST_PREVIEW_CAPACITY]!;
            events.push(
                Object.freeze({
                    beatTime: slot.beatTime,
                    durationBeats: slot.durationBeats,
                    pitch: slot.pitch,
                    velocity: slot.velocity,
                    probability: slot.probability,
                    realized: slot.realized,
                    processorId: slot.processorId,
                    bypassed: slot.bypassed,
                })
            );
        }

        const droppedEvents = this.droppedEvents;
        this.readIndex = (this.readIndex + this.size) % YEAST_PREVIEW_CAPACITY;
        this.size = 0;
        this.droppedEvents = 0;

        return Object.freeze({
            capacity: YEAST_PREVIEW_CAPACITY,
            events: Object.freeze(events),
            droppedEvents,
        });
    }

    getStorageIdentity(): object {
        return this.storage;
    }

    private startPairingEpoch(): void {
        this.epoch = (this.epoch + 1) >>> 0;
        if (this.epoch !== 0) {
            return;
        }
        this.pendingEpoch.fill(0);
        this.epoch = 1;
    }

    private publishNoteOn(
        timeSamples: number,
        kind: NoteOnKind,
        blockStartSamples: number,
        samplesPerBeat: number,
        ppqPosition: number,
        processorId: string,
        bypassed: boolean
    ): void {
        if (this.size === YEAST_PREVIEW_CAPACITY) {
            this.droppedEvents += 1;
            return;
        }

        const slotIndex = (this.readIndex + this.size) % YEAST_PREVIEW_CAPACITY;
        const slot = this.storage[slotIndex]!;
        slot.beatTime = ppqPosition + (timeSamples - blockStartSamples) / samplesPerBeat;
        slot.durationBeats = 0;
        slot.pitch = kind.note;
        slot.velocity = kind.velocity;
        slot.probability = null;
        slot.realized = true;
        slot.processorId = processorId;
        slot.bypassed = bypassed;
        this.noteOnSamples[slotIndex] = timeSamples;
        this.size += 1;

        const noteKey = (kind.channel << 7) | kind.note;
        this.enqueuePendingNote(noteKey, slotIndex);
    }

    private enqueuePendingNote(noteKey: number, slotIndex: number): void {
        this.pendingNext[slotIndex] = NO_PENDING_SLOT;
        if (this.pendingEpoch[noteKey] !== this.epoch) {
            this.pendingEpoch[noteKey] = this.epoch;
            this.pendingHead[noteKey] = slotIndex;
            this.pendingTail[noteKey] = slotIndex;
            return;
        }

        const tail = this.pendingTail[noteKey]!;
        this.pendingNext[tail] = slotIndex;
        this.pendingTail[noteKey] = slotIndex;
    }

    private pairNoteOff(timeSamples: number, kind: NoteOffKind, samplesPerBeat: number): void {
        const noteKey = (kind.channel << 7) | kind.note;
        if (this.pendingEpoch[noteKey] !== this.epoch) {
            return;
        }

        const slotIndex = this.pendingHead[noteKey]!;
        if (slotIndex === NO_PENDING_SLOT) {
            return;
        }

        const nextSlot = this.pendingNext[slotIndex]!;
        this.pendingHead[noteKey] = nextSlot;
        if (nextSlot === NO_PENDING_SLOT) {
            this.pendingTail[noteKey] = NO_PENDING_SLOT;
        }

        this.storage[slotIndex]!.durationBeats = Math.max(
            0,
            (timeSamples - this.noteOnSamples[slotIndex]!) / samplesPerBeat
        );
    }
}

export const yeastPreviewTap = new YeastPreviewTap();
