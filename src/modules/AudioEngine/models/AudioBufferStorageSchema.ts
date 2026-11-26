export const AUDIO_BUFFER_DATABASE_NAME = 'sourdaw-audio';
export const AUDIO_BUFFER_DATABASE_VERSION = 5;
export const AUDIO_BUFFER_PCM_STORE = 'buffers';

/** Everything the age and size collectors read, split out of the record so that
 * moving a timestamp does not rewrite the audio next to it.
 *
 * A record is `sampleRate` and `numberOfChannels` and then however many
 * megabytes of `Float32Array`; the two numbers the collectors want are 16 bytes
 * of it. IndexedDB has no partial update, so `put`ting a record back to change
 * `lastAccessed` rewrites the PCM — 384 KB per second of 48 kHz stereo, so
 * ~1.5 MB for a four-second loop and ~69 MB for a three-minute freeze bounce,
 * once per id per refresh window, forever. And both collectors reached those
 * two numbers through `getAll()`, materialising every record in the store to
 * read them; `cleanupUnusedFreezeFiles` caps that store at 2 GiB.
 *
 * Measured in `audioBufferCacheMetadataStore.spec.ts` on one second of 48 kHz
 * stereo: a refresh wrote 384 152 bytes and now writes 62, and a two-record
 * collector pass read 768 322 bytes (age) / 768 324 (size) and now reads 142 /
 * 144 — the rows and their keys, and no PCM at all.
 *
 * The record keeps its own `lastAccessed` and `sizeInBytes` fields. They stop
 * being the collectors' input at this version and become what the record was
 * persisted with — which is exactly what the lazy back-fill needs to seed a row
 * for a record written before this store existed. */
export const AUDIO_BUFFER_METADATA_STORE = 'bufferMeta';
