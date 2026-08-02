/**
 * Shared control-plane layout for Grand Boule's live Worker-to-Worklet ring.
 *
 * This is a data-only transport model. Both isolated hosts consume it, and a
 * numeric drift between producer and consumer would reinterpret audio samples
 * as atomics.
 */
export const GRAND_BOULE_CONTROL_INT_COUNT = 7;
export const GRAND_BOULE_CONTROL_HEADER_BYTES = GRAND_BOULE_CONTROL_INT_COUNT * Int32Array.BYTES_PER_ELEMENT;

export const GRAND_BOULE_WRITE_HEAD_IDX = 0;
export const GRAND_BOULE_READ_HEAD_IDX = 1;
export const GRAND_BOULE_RENDER_REQUEST_IDX = 2;
export const GRAND_BOULE_SLEEP_HEAD_IDX = 3;
export const GRAND_BOULE_LIFECYCLE_IDX = 4;
export const GRAND_BOULE_FLUSH_GENERATION_IDX = 5;
export const GRAND_BOULE_FLUSH_HEAD_IDX = 6;

export const GRAND_BOULE_LIFECYCLE_CONTINUE = 0;
export const GRAND_BOULE_LIFECYCLE_SLEEP = 3;

/**
 * Consumer-clock synchronization layout. Runtime publication and read behavior
 * lives in services; models owns only the shared numeric protocol.
 */
export const GRAND_BOULE_SYNC_INT_COUNT = 5;
export const GRAND_BOULE_SYNC_SEQUENCE_IDX = 0;
export const GRAND_BOULE_CONSUMER_CONTEXT_LOW_IDX = 1;
export const GRAND_BOULE_CONSUMER_CONTEXT_HIGH_IDX = 2;
export const GRAND_BOULE_SYNC_READ_HEAD_IDX = 3;
export const GRAND_BOULE_CONSUMER_CLOCK_PUBLISHED_IDX = 4;
