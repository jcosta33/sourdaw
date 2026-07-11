/**
 * Validate resolved DSOs against the current DAW state and operation bounds.
 */
import { trackStore } from '#/modules/Arrangement/stores';

import { type Dso } from '../../models/DsoTypes';

import { validateDsoTimeSignature } from './services/validateDsoTimeSignature';

type DsoValidationError = {
    dso: Dso;
    reason: string;
};

export function validateDsos(dsos: Dso[]): DsoValidationError[] {
    const errors: DsoValidationError[] = [];
    const state = trackStore.value;
    const trackIds = new Set(state?.tracks.map((time) => time.id) ?? []);
    const clipIds = new Set(state?.tracks.flatMap((time) => time.clips.map((context) => context.id)) ?? []);
    const deviceIds = new Set(state?.tracks.flatMap((time) => time.devices.map((data) => data.id)) ?? []);

    // Pre-register IDs injected by resolveDsoNames for add_track DSOs so that
    // subsequent DSOs in the same batch that target those new tracks are not
    // incorrectly rejected (the store hasn't been updated yet at validation time).
    for (const dso of dsos) {
        if (dso.op === 'add_track') {
            const injectedId = (dso as Record<string, unknown>).track_id;
            if (typeof injectedId === 'string') {
                trackIds.add(injectedId);
            }
        }
    }

    for (const dso of dsos) {
        switch (dso.op) {
            case 'remove_track':
            case 'rename_track':
            case 'mute_track':
            case 'solo_track':
            case 'arm_track':
            case 'color_track':
            case 'reorder_track':
                if (!trackIds.has(dso.track_id)) {
                    errors.push({ dso, reason: `Track "${dso.track_id}" does not exist` });
                }
                break;

            case 'insert_device':
                if (!trackIds.has(dso.track_id)) {
                    errors.push({ dso, reason: `Track "${dso.track_id}" does not exist` });
                }
                break;

            case 'add_clip':
                if (!trackIds.has(dso.track_id)) {
                    errors.push({ dso, reason: `Track "${dso.track_id}" does not exist` });
                }
                if (dso.end_beats <= dso.start_beats) {
                    errors.push({ dso, reason: `Clip end must be after start` });
                }
                break;

            case 'remove_clip':
            case 'rename_clip':
            case 'split_clip':
            case 'transpose_notes':
            case 'humanize_midi':
                if (!clipIds.has(dso.clip_id)) {
                    errors.push({ dso, reason: `Clip "${dso.clip_id}" does not exist` });
                }
                break;

            case 'move_clip':
            case 'duplicate_clip':
                if (!clipIds.has(dso.clip_id)) {
                    errors.push({ dso, reason: `Clip "${dso.clip_id}" does not exist` });
                }
                if (!trackIds.has(dso.destination_track_id)) {
                    errors.push({ dso, reason: `Destination track "${dso.destination_track_id}" does not exist` });
                }
                break;

            case 'remove_device':
            case 'bypass_device':
                if (!deviceIds.has(dso.device_id)) {
                    errors.push({ dso, reason: `Device "${dso.device_id}" does not exist` });
                }
                break;

            case 'set_tempo':
                if (dso.bpm < 20 || dso.bpm > 999) {
                    errors.push({ dso, reason: `Tempo ${dso.bpm} out of range (20-999)` });
                }
                break;

            case 'set_track_volume':
                if (!trackIds.has(dso.track_id)) {
                    errors.push({ dso, reason: `Track "${dso.track_id}" does not exist` });
                }
                if (dso.gain < 0 || dso.gain > 1.5) {
                    errors.push({ dso, reason: `Gain ${dso.gain} out of range (0-1.5)` });
                }
                break;

            case 'set_track_pan':
                if (!trackIds.has(dso.track_id)) {
                    errors.push({ dso, reason: `Track "${dso.track_id}" does not exist` });
                }
                if (dso.pan < -50 || dso.pan > 50) {
                    errors.push({ dso, reason: `Pan ${dso.pan} out of range (-50 to 50)` });
                }
                break;

            case 'create_send':
                if (!trackIds.has(dso.from_track_id)) {
                    errors.push({ dso, reason: `Source track "${dso.from_track_id}" does not exist` });
                }
                if (!trackIds.has(dso.to_track_id)) {
                    errors.push({ dso, reason: `Destination track "${dso.to_track_id}" does not exist` });
                }
                break;

            case 'set_device_param':
                if (dso.device_id !== 'latest' && !deviceIds.has(dso.device_id)) {
                    errors.push({ dso, reason: `Device "${dso.device_id}" does not exist` });
                }
                break;

            case 'add_midi_notes':
                if (!clipIds.has(dso.clip_id)) {
                    errors.push({ dso, reason: `Clip "${dso.clip_id}" does not exist` });
                }
                for (let index = 0; index < dso.notes.length; index++) {
                    const node = dso.notes[index]!;
                    if (node.pitch < 0 || node.pitch > 127) {
                        errors.push({ dso, reason: `Note ${index} pitch ${node.pitch} out of range (0-127)` });
                    }
                    if (node.velocity < 0 || node.velocity > 127) {
                        errors.push({ dso, reason: `Note ${index} velocity ${node.velocity} out of range (0-127)` });
                    }
                }
                break;

            case 'set_clip_gain':
                if (!clipIds.has(dso.clip_id)) {
                    errors.push({ dso, reason: `Clip "${dso.clip_id}" does not exist` });
                }
                if (dso.gain < 0 || dso.gain > 2) {
                    errors.push({ dso, reason: `Clip gain ${dso.gain} out of range (0-2)` });
                }
                break;

            case 'generate_melody':
            case 'generate_chords':
            case 'generate_drums':
                if (!trackIds.has(dso.track_id)) {
                    errors.push({ dso, reason: `Track "${dso.track_id}" does not exist` });
                }
                break;

            case 'set_time_signature':
                {
                    const reason = validateDsoTimeSignature({
                        numerator: dso.numerator,
                        denominator: dso.denominator,
                    });
                    if (reason) {
                        errors.push({ dso, reason });
                    }
                }
                break;

            case 'add_track':
            case 'set_loop':
                break;
        }
    }

    return errors;
}
