/**
 * The MIDI note state a rendered phrase is checked against. Only the clip
 * keys and the identity of each clip's note list are read: an edit replaces
 * the clip's list.
 */
type MidiNoteState = { readonly notesByClipId: Readonly<Record<string, unknown>> } | null;

/** Where BrowserAi learns that a clip's notes were edited. */
type MidiNoteEditSource = {
    /**
     * Calls `listener` with every published MIDI note state, as the MIDI
     * store publishes it, and returns the unsubscribe.
     */
    subscribe: (listener: (next: MidiNoteState) => void) => () => void;
};

let registeredSource: MidiNoteEditSource | null = null;

/**
 * BrowserAi is an engine-tier module and may not import MIDI, which owns the
 * notes, so the composition root (`#/app/registerSupportingServicePorts`)
 * fills this once at boot, before `initBrowserAi` subscribes.
 */
export const midiNoteEditSource = {
    /**
     * Registering the identical source again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(source: MidiNoteEditSource): void {
        if (registeredSource === null) {
            registeredSource = source;
            return;
        }
        if (registeredSource.subscribe !== source.subscribe) {
            throw new Error('midiNoteEditSource.configure: the source differs from the registered one');
        }
    },
    /**
     * The registered source. Reading before registration throws rather than
     * subscribing to nothing: a rendered phrase would then never go stale
     * when its clip is edited.
     */
    read(caller: string): MidiNoteEditSource {
        if (registeredSource === null) {
            throw new Error(
                `${caller}: the MIDI note edit source is not registered; call registerSupportingServicePorts() from #/app/registerSupportingServicePorts (bootstrap does this)`
            );
        }
        return registeredSource;
    },
};
