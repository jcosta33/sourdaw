/**
 * Decoded Control Change state, one entry per MIDI channel (audit MD-7, MD-8).
 *
 * Singleton module alongside `state.ts` — the live Web MIDI repository owns all
 * device-scoped runtime state. Entries are created lazily on first traffic and
 * dropped wholesale when the input device is reset or torn down, so a newly
 * selected controller starts from spec defaults rather than inheriting the
 * previous one's declared bend range.
 */
import { type MidiChannelControllerState } from '../../models/MidiControllerState';

export const channelControllerState = new Map<number, MidiChannelControllerState>();
