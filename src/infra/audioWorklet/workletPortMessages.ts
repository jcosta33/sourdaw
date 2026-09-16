/**
 * Message-type discriminants for the MessagePort protocol between the
 * main-thread worklet-node wrappers (`engine/*Node.ts`) and their WASM-backed
 * AudioWorklet processors.
 *
 * Owned here so every main-thread sender and receiver shares one spelling — a
 * drifted discriminant silently drops messages, because neither side errors.
 * The processors themselves run in the isolated worklet realm and restate
 * these values with pointer comments back to this file; a parity spec
 * (`AudioEngine/services/__tests__/workletPortMessageParity.spec.ts`) pins the
 * copies equal.
 */

/** Hands the processor its telemetry SharedArrayBuffer slot. */
export const INIT_SAB_MESSAGE_TYPE = 'init-sab';

/** Processor → node: the instance's latency in samples changed. */
export const LATENCY_CHANGED_MESSAGE_TYPE = 'latency-changed';
