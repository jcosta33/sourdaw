import { YEAST_PREVIEW_CAPACITY } from '../models/YeastPreviewSnapshot';

import type { YeastPreviewBlock, YeastPreviewEvent, YeastPreviewSnapshot } from '../models/YeastPreviewSnapshot';

export { YEAST_PREVIEW_CAPACITY } from '../models/YeastPreviewSnapshot';

type MutableYeastPreviewEvent = {
    -readonly [Key in keyof YeastPreviewEvent]: YeastPreviewEvent[Key];
};

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
        failed: false,
    };
}

export class YeastPreviewTap {
    private readonly storage: MutableYeastPreviewEvent[];
    private readIndex = 0;
    private size = 0;
    private droppedEvents = 0;
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

    isEnabled(): boolean {
        return this.enabled;
    }

    publish(input: YeastPreviewBlock): void {
        if (!this.enabled) {
            return;
        }

        this.droppedEvents += input.droppedEvents;
        for (let index = 0; index < input.records.length; index++) {
            if (this.size === YEAST_PREVIEW_CAPACITY) {
                this.droppedEvents += 1;
                continue;
            }
            const record = input.records[index]!;
            const slot = this.storage[(this.readIndex + this.size) % YEAST_PREVIEW_CAPACITY]!;
            slot.beatTime = record.beatTime;
            slot.durationBeats = record.durationBeats;
            slot.pitch = record.pitch;
            slot.velocity = record.velocity;
            slot.probability = record.probability;
            slot.realized = record.realized;
            slot.processorId = record.processorId;
            slot.bypassed = record.bypassed;
            slot.failed = record.failed;
            this.size += 1;
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
                    failed: slot.failed,
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
}

export const yeastPreviewTap = new YeastPreviewTap();
