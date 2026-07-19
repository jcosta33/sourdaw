type VoiceNode<TValue> = {
    value: TValue;
    next: VoiceNode<TValue> | null;
};

type VoiceQueue<TValue> = {
    head: VoiceNode<TValue>;
    tail: VoiceNode<TValue>;
};

const DEFAULT_NOTE_VOICE_CAPACITY = 4096;

/**
 * Route/key-scoped FIFO storage for overlapping MIDI note instances.
 *
 * The live node count is capped. Exceeding the cap throws before mutation so
 * MidiRack can fail the current rack generation and resume its transparent
 * fallback instead of silently evicting a voice whose Note Off would hang.
 */
export class BoundedNoteVoiceQueue<TValue> {
    private readonly routes = new Map<string | undefined, Map<number, VoiceQueue<TValue>>>();
    private count = 0;

    constructor(private readonly capacity = DEFAULT_NOTE_VOICE_CAPACITY) {}

    push(routeId: string | undefined, key: number, value: TValue): void {
        if (this.count >= this.capacity) {
            throw new Error(`Yeast note voice capacity exceeded (${this.capacity})`);
        }

        const node: VoiceNode<TValue> = { value, next: null };
        let route = this.routes.get(routeId);
        if (!route) {
            route = new Map();
            this.routes.set(routeId, route);
        }
        const queue = route.get(key);
        if (queue) {
            queue.tail.next = node;
            queue.tail = node;
        } else {
            route.set(key, { head: node, tail: node });
        }
        this.count += 1;
    }

    shift(routeId: string | undefined, key: number): TValue | undefined {
        const route = this.routes.get(routeId);
        const queue = route?.get(key);
        if (!route || !queue) {
            return undefined;
        }

        const node = queue.head;
        if (node.next) {
            queue.head = node.next;
        } else {
            route.delete(key);
            if (route.size === 0) {
                this.routes.delete(routeId);
            }
        }
        this.count -= 1;
        return node.value;
    }

    visit(visitVoice: (value: TValue, routeId: string | undefined, key: number) => void): void {
        for (const [routeId, route] of this.routes) {
            for (const [key, queue] of route) {
                let node: VoiceNode<TValue> | null = queue.head;
                while (node) {
                    visitVoice(node.value, routeId, key);
                    node = node.next;
                }
            }
        }
    }

    clear(): void {
        this.routes.clear();
        this.count = 0;
    }

    get size(): number {
        return this.count;
    }
}
