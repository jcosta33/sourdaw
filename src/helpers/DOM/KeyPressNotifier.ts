/* (c) Copyright Frontify Ltd., all rights reserved. */

export const isMacOs = () => navigator.platform.toUpperCase().includes('MAC');

export type EventListener<TKeyboardEvent extends KeyboardEvent = KeyboardEvent> =
    | ((event: TKeyboardEvent) => void)
    | undefined;

type KeyPressNotifierProps<TKeyboardEvent extends KeyboardEvent = KeyboardEvent> = {
    hotkey: string;
    listener: EventListener<TKeyboardEvent>;
};

export type HotKey<TKeyboardEvent extends KeyboardEvent = KeyboardEvent> =
    | string
    | string[]
    | KeyPressNotifierProps<TKeyboardEvent>[];

export class KeyPressNotifier<TKeyboardEvent extends KeyboardEvent = KeyboardEvent> {
    static #instance: Nullable<KeyPressNotifier<KeyboardEvent>>;

    readonly #listeners = new Map<string, Set<EventListener<TKeyboardEvent>>>();

    private constructor() {}

    public static getInstance(): KeyPressNotifier<KeyboardEvent> {
        if (!this.#instance) {
            this.#instance = new KeyPressNotifier();
        }

        return this.#instance;
    }

    public subscribe(hotKey: HotKey<TKeyboardEvent>, listener?: EventListener<TKeyboardEvent>): () => void {
        const subscriptionsToAdd: KeyPressNotifierProps<TKeyboardEvent>[] = [];

        if (this.#isHotKeyString(hotKey)) {
            subscriptionsToAdd.push({ hotkey: hotKey, listener });
        } else if (this.#isHotKeyArrayOfStrings(hotKey)) {
            for (const key of hotKey) {
                subscriptionsToAdd.push({ hotkey: key, listener });
            }
        } else if (Array.isArray(hotKey)) {
            subscriptionsToAdd.push(...hotKey);
        }

        if (subscriptionsToAdd.length === 0) {
            return () => {};
        }

        for (const { hotkey, listener } of subscriptionsToAdd) {
            const key = this.#getKey(hotkey);

            this.#addSubscription(key, listener);
        }

        return () => {
            for (const { hotkey, listener } of subscriptionsToAdd) {
                const key = this.#getKey(hotkey);
                this.#removeSubscription(key, listener);
            }
        };
    }

    public unsubscribe(hotkey: string) {
        const key = this.#getKey(hotkey);
        this.#listeners.delete(key);
    }

    public notify(event: TKeyboardEvent, listener: EventListener<TKeyboardEvent>) {
        const hotKeyCombination = this.#getHotKeyCombination(event);

        if (!hotKeyCombination) {
            return;
        }

        const listenersSet = this.#listeners.get(hotKeyCombination);

        if (listenersSet && listenersSet.size > 0) {
            event.preventDefault();

            if (listenersSet.has(listener)) {
                listener?.(event);
            }
        }
    }

    #addSubscription(key: string, listener: EventListener<TKeyboardEvent>) {
        let listenersSet = this.#listeners.get(key);

        if (!listenersSet) {
            listenersSet = new Set();
            this.#listeners.set(key, listenersSet);
        }

        listenersSet.add(listener);
    }

    #removeSubscription(key: string, listener: EventListener<TKeyboardEvent>) {
        const listenersSet = this.#listeners.get(key);

        if (listenersSet) {
            listenersSet.delete(listener);

            if (listenersSet.size === 0) {
                this.#listeners.delete(key);
            }
        }
    }

    #isHotKeyString(hotKey: unknown): hotKey is string {
        return typeof hotKey === 'string';
    }

    #isHotKeyArrayOfStrings(hotKey: unknown): hotKey is string[] {
        return Array.isArray(hotKey) && typeof hotKey[0] === 'string';
    }

    #getKey(hotkey: string): string {
        const standardized = hotkey
            .toUpperCase()
            .replaceAll(/COMMAND|CMD|WINDOWS|WIN/g, 'META')
            .replaceAll('OPTION', 'OPT');

        return this.#stringify(standardized.split('+'));
    }

    #getHotKeyCombination(event: TKeyboardEvent): string | null {
        if (!this.#isKeyboardEvent(event)) {
            return null;
        }

        const combination: string[] = [event.key.toUpperCase()];

        if (event.altKey) {
            combination.push('OPT');
        }
        if (event.shiftKey) {
            combination.push('SHIFT');
        }
        if ((isMacOs() && event.metaKey) || (!isMacOs() && event.ctrlKey)) {
            combination.push('META');
        }

        return this.#stringify(combination);
    }

    #isKeyboardEvent(event: unknown): event is KeyboardEvent {
        return event instanceof KeyboardEvent;
    }

    #stringify(arr: string[]) {
        return JSON.stringify(arr.toSorted((a, b) => a.localeCompare(b)));
    }
}
