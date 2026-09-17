/**
 * Wire contract between `engine/YeastWorkerClient.ts` and
 * `workers/yeastWorker.ts`. Both realms import this file, so the protocol
 * version and every message discriminant are spelled once — a drifted literal
 * on either side of the postMessage boundary is a message the other side
 * silently drops, and the client's pending Promise would wait out its deadline
 * for a reply that never comes.
 *
 * The full message set is the one `yeastWorker.ts`'s header documents; the
 * MIDI event kinds travel inside `processBlock`/ack payloads and are validated
 * on both sides, so they are owned here too.
 */

/**
 * Bumped only on a breaking change to the message shapes below. The client
 * refuses a `ready` from any other version rather than guessing at a
 * mismatched protocol.
 */
export const YEAST_WORKER_PROTOCOL_VERSION = 1;

export const YEAST_WORKER_MESSAGE_TYPE = {
    initialize: 'initialize',
    ready: 'ready',
    processBlock: 'processBlock',
    processed: 'processed',
    processedError: 'processedError',
    setProjection: 'setProjection',
    projectionAck: 'projectionAck',
    projectionError: 'projectionError',
    executeCommand: 'executeCommand',
    commandAck: 'commandAck',
    allNotesOff: 'allNotesOff',
    allNotesOffAck: 'allNotesOffAck',
    releasePreview: 'releasePreview',
    previewPage: 'previewPage',
} as const;

/** Discriminants of `MidiEvent['kind']` as they cross the worker boundary. */
export const YEAST_MIDI_EVENT_KIND = {
    noteOn: 'noteOn',
    noteOff: 'noteOff',
    cc: 'cc',
    pitchBend: 'pitchBend',
    channelPressure: 'channelPressure',
} as const;
