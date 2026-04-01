/**
 * Domain-Specific Operations (DSOs) — the edit protocol between the LLM and the DAW.
 *
 * The LLM emits typed DSOs. The backend compiles them into concrete store mutations.
 * DSOs are high-level intent — the LLM never generates raw JSON patches or store mutations.
 *
 * This is the ONLY schema the LLM is allowed to produce.
 */

// ── Moderation ───────────────────────────────────────────────────────────────

export type ModerationDecision = 'allow' | 'needs_confirmation' | 'block';

// ── DSO Operations ───────────────────────────────────────────────────────────

export type Dso =
    | { op: 'add_track'; name: string; kind: 'audio' | 'midi' | 'bus' }
    | { op: 'remove_track'; track_id: string }
    | { op: 'rename_track'; track_id: string; name: string }
    | { op: 'set_track_volume'; track_id: string; gain: number }
    | { op: 'set_track_pan'; track_id: string; pan: number }
    | { op: 'mute_track'; track_id: string; muted: boolean }
    | { op: 'solo_track'; track_id: string; soloed: boolean }
    | { op: 'arm_track'; track_id: string; armed: boolean }
    | { op: 'color_track'; track_id: string; color: string }
    | { op: 'reorder_track'; track_id: string; new_index: number }
    | { op: 'duplicate_clip'; clip_id: string; destination_track_id: string; destination_start_beats: number }
    | { op: 'move_clip'; clip_id: string; destination_track_id: string; destination_start_beats: number }
    | { op: 'add_clip'; track_id: string; name: string; type: 'audio' | 'midi'; start_beats: number; end_beats: number }
    | { op: 'remove_clip'; clip_id: string }
    | { op: 'rename_clip'; clip_id: string; name: string }
    | { op: 'split_clip'; clip_id: string; split_at_beats: number }
    | { op: 'insert_device'; track_id: string; device_type: string }
    | { op: 'remove_device'; device_id: string; track_id: string }
    | { op: 'bypass_device'; device_id: string; bypassed: boolean }
    | { op: 'set_tempo'; bpm: number }
    | { op: 'set_time_signature'; numerator: number; denominator: number }
    | { op: 'transpose_notes'; clip_id: string; semitones: number }
    | { op: 'humanize_midi'; clip_id: string; timing_amount: number; velocity_amount: number }
    | { op: 'create_send'; from_track_id: string; to_track_id: string; gain: number }
    | { op: 'set_loop'; start_beats: number; end_beats: number; enabled: boolean }
    | { op: 'set_device_param'; device_id: string; param_name: string; value: number }
    | {
          op: 'add_midi_notes';
          clip_id: string;
          notes: Array<{ pitch: number; start_beat: number; duration: number; velocity: number }>;
      }
    | { op: 'set_clip_gain'; clip_id: string; gain: number }
    | {
          op: 'generate_melody';
          track_id: string;
          start_beat?: number;
          style: string;
          key: string;
          scale: string;
          octave: number;
          bars: number;
          density: number;
      }
    | {
          op: 'generate_chords';
          track_id: string;
          start_beat?: number;
          key: string;
          progression: string;
          bars: number;
          voicing: string;
      }
    | { op: 'generate_drums'; track_id: string; start_beat?: number; style: string; bars: number; density: number };

// ── EditPlan envelope ────────────────────────────────────────────────────────

export type EditPlan = {
    kind: 'edit_plan';
    moderation: ModerationDecision;
    intent: string;
    dsos: Dso[];
};

// ── JSON Schema for the EditPlan ─────────────────────────────────────────────
// This is passed to Constraint::JsonSchema for schema-constrained generation.

export const EDIT_PLAN_JSON_SCHEMA = JSON.stringify({
    type: 'object',
    required: ['kind', 'moderation', 'intent', 'dsos'],
    additionalProperties: false,
    properties: {
        kind: { type: 'string', const: 'edit_plan' },
        moderation: { type: 'string', enum: ['allow', 'needs_confirmation', 'block'] },
        intent: { type: 'string' },
        dsos: {
            type: 'array',
            items: {
                type: 'object',
                required: ['op'],
                properties: {
                    op: {
                        type: 'string',
                        enum: [
                            'add_track',
                            'remove_track',
                            'rename_track',
                            'set_track_volume',
                            'set_track_pan',
                            'mute_track',
                            'solo_track',
                            'arm_track',
                            'color_track',
                            'reorder_track',
                            'duplicate_clip',
                            'move_clip',
                            'add_clip',
                            'remove_clip',
                            'rename_clip',
                            'split_clip',
                            'insert_device',
                            'remove_device',
                            'bypass_device',
                            'set_tempo',
                            'set_time_signature',
                            'transpose_notes',
                            'humanize_midi',
                            'create_send',
                            'set_loop',
                            'set_device_param',
                            'add_midi_notes',
                            'set_clip_gain',
                            'generate_melody',
                            'generate_chords',
                            'generate_drums',
                        ],
                    },
                    // All other fields are operation-specific
                    name: { type: 'string' },
                    kind: { type: 'string' },
                    track_id: { type: 'string' },
                    clip_id: { type: 'string' },
                    device_id: { type: 'string' },
                    device_type: { type: 'string' },
                    param_name: { type: 'string' },
                    destination_track_id: { type: 'string' },
                    from_track_id: { type: 'string' },
                    to_track_id: { type: 'string' },
                    destination_start_beats: { type: 'number' },
                    start_beats: { type: 'number' },
                    end_beats: { type: 'number' },
                    split_at_beats: { type: 'number' },
                    start_beat: { type: 'number' },
                    new_index: { type: 'number' },
                    gain: { type: 'number' },
                    pan: { type: 'number' },
                    bpm: { type: 'number' },
                    numerator: { type: 'number' },
                    denominator: { type: 'number' },
                    semitones: { type: 'number' },
                    timing_amount: { type: 'number' },
                    velocity_amount: { type: 'number' },
                    value: { type: 'number' },
                    pitch: { type: 'number' },
                    duration: { type: 'number' },
                    velocity: { type: 'number' },
                    muted: { type: 'boolean' },
                    soloed: { type: 'boolean' },
                    armed: { type: 'boolean' },
                    bypassed: { type: 'boolean' },
                    enabled: { type: 'boolean' },
                    color: { type: 'string' },
                    type: { type: 'string' },
                    key: { type: 'string' },
                    scale: { type: 'string' },
                    octave: { type: 'number' },
                    bars: { type: 'number' },
                    density: { type: 'number' },
                    progression: { type: 'string' },
                    voicing: { type: 'string' },
                    style: { type: 'string' },
                    notes: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['pitch', 'start_beat', 'duration', 'velocity'],
                            properties: {
                                pitch: { type: 'number' },
                                start_beat: { type: 'number' },
                                duration: { type: 'number' },
                                velocity: { type: 'number' },
                            },
                        },
                    },
                },
            },
        },
    },
});

// ── Safety classification ────────────────────────────────────────────────────

export type CommitClassification = 'auto_apply' | 'preview_required' | 'confirmation_required';

/** Only destructive operations require confirmation. Everything else auto-applies. */
const CONFIRMATION_REQUIRED_OPS = new Set(['remove_track', 'remove_clip', 'remove_device']);

export function classifyDso(dso: Dso): CommitClassification {
    if (CONFIRMATION_REQUIRED_OPS.has(dso.op)) {
        return 'confirmation_required';
    }
    return 'auto_apply';
}

export function classifyEditPlan(plan: EditPlan): CommitClassification {
    if (plan.moderation === 'block') {
        return 'confirmation_required';
    }

    // Only require confirmation if the moderation field says so
    // OR if any DSO is actually destructive (remove_track, remove_clip, remove_device)
    for (const dso of plan.dsos) {
        if (CONFIRMATION_REQUIRED_OPS.has(dso.op)) {
            return 'confirmation_required';
        }
    }

    // "needs_confirmation" from the model is advisory — if no DSOs are destructive,
    // treat it as auto_apply (the model is being overly cautious)
    return 'auto_apply';
}
