//! Plugin slot — trait for external plugins processed on the native audio thread.

use std::any::Any;

/// A MIDI note event to send to a plugin.
#[derive(Clone, Copy)]
pub struct MidiNoteEvent {
    pub note: u8,
    pub velocity: u8,
    pub channel: i16,
    pub is_note_on: bool,
    /// The sample, inside the buffer handed to
    /// [`NativePlugin::process_with_events`], at which this event applies.
    ///
    /// Zero for an event delivered at the head of a block, which is the
    /// immediate path's only answer: a note played live has no timeline
    /// position to stamp it against. A scheduled note carries the distance
    /// from the block's first frame to the timeline frame it was written on,
    /// so the instrument sounds it on that sample rather than on whichever
    /// block boundary happened to reach it first.
    pub frame_offset: u32,
    /// Fixed acceptance cutoff in the inclusive range 0..=2^32.
    pub probability_cutoff: u64,
    pub project_probability_seed: u32,
    pub clip_id_hash: u32,
    pub event_id_hash: u32,
    pub absolute_occurrence_index: u64,
}

/// Transport state for plugins that need tempo/position info.
///
/// Ownership is split by field, not by writer: tempo and time signature are
/// owned by `GraphCommand::SetTransport` (whose live producer arrives with
/// the live cutover), while `is_playing` and the song position are also
/// written by the graph path (`GraphCommand::SetTransportPlayback`),
/// which merges into the held state and re-derives `song_pos_beats` from the
/// tempo it does not own. A graph transport write can never move a
/// plugin-visible tempo or time signature.
#[derive(Clone, Copy)]
pub struct TransportState {
    pub tempo: f64,
    pub time_sig_num: u16,
    pub time_sig_denom: u16,
    pub is_playing: bool,
    pub song_pos_beats: f64,
    pub song_pos_seconds: f64,
}

impl Default for TransportState {
    fn default() -> Self {
        Self {
            tempo: 120.0,
            time_sig_num: 4,
            time_sig_denom: 4,
            is_playing: false,
            song_pos_beats: 0.0,
            song_pos_seconds: 0.0,
        }
    }
}

/// One render chunk of the engine's native input tap, deinterleaved from the
/// device's own capture stream.
///
/// Borrowed and `Copy`: it names scratch the render callback owns for the
/// length of one call, so a consumer that keeps the audio copies it out. There
/// is no owned form, because materialising one would be an allocation on the
/// audio thread.
#[derive(Clone, Copy)]
pub struct CaptureInputBlock<'a> {
    /// The device's first captured channel. Zeros when `served` is false.
    pub left: &'a [f32],
    /// The device's second captured channel, or a copy of the first when the
    /// device is mono. Zeros when `served` is false.
    pub right: &'a [f32],
    /// Frames in `left` and `right`, which are the same length.
    pub frames: usize,
    /// Whether the capture ring had this chunk's audio. False means the ring
    /// is filling or stalled, the counted shortfall is already recorded, and
    /// the two slices are silence rather than stale samples.
    pub served: bool,
    /// Frames of delay the capture path is currently adding, or zero while it
    /// publishes no figure. A recorder offsets its take by this.
    pub latency_frames: usize,
    /// Frames delivered on this stream before this block, counted whether or
    /// not they were served. It is a capture timeline, not the transport's:
    /// a re-settle after a device cadence change shows as a run of unserved
    /// blocks and then a changed `latency_frames`, which a recorder can splice
    /// on rather than concatenate across.
    pub position_frames: u64,
}

/// Trait for a plugin that can process audio on the real-time thread.
pub trait NativePlugin: Any + Send {
    /// Process a block of stereo audio in-place.
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize);

    /// Process audio with MIDI events and transport info.
    /// Default implementation ignores MIDI/transport and delegates to process_audio.
    fn process_with_events(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        _midi_events: &[MidiNoteEvent],
        _transport: &TransportState,
    ) {
        self.process_audio(left, right, num_samples);
    }

    /// Receive one chunk of the engine's native input tap — real audio from
    /// the input device, deinterleaved, delivered only to a plugin that
    /// registered for it.
    ///
    /// Distinct from [`Self::process_audio`], which renders the signal a chain
    /// carries: this is the device's own capture stream, and it is an input
    /// rather than an in-place process, so nothing a plugin does here reaches
    /// the output. A plugin that records overrides it; the default ignores the
    /// block, so a plugin registered by mistake is inert rather than wrong.
    fn process_capture_input(&mut self, _block: CaptureInputBlock<'_>) {}

    /// Queue one of this plugin's own parameters for its next process call.
    ///
    /// Audio-thread only, and bound by the audio thread's law: it must not
    /// allocate, lock, or block. The scheduler calls it from
    /// `apply_due_device_params`, which runs before the chain renders the span
    /// that reached the stamp, so the write is drained by the next process call
    /// this plugin actually receives — normally this same block's. A hosted
    /// plugin's process path takes the access seam it shares with the control
    /// path and skips the block outright rather than waiting when the control
    /// path holds it, so a control operation landing on this block pushes the
    /// drain to a later one.
    ///
    /// `true` means the write is queued. `false` refuses it, and the caller
    /// counts the refusal as an unmapped parameter call — the default, because
    /// a plugin body with no addressable parameters (a built-in wrapper, a
    /// fixture) has nothing to queue the write against.
    fn apply_parameter_on_audio_thread(&mut self, _id: u32, _value: f64) -> bool {
        false
    }

    /// Get the plugin's name (for logging).
    fn name(&self) -> &str;

    /// Whether this plugin accepts MIDI input (instruments).
    fn accepts_midi(&self) -> bool {
        false
    }

    /// Expose concrete plugin adapters to non-RT control code after transfer.
    fn as_any(&self) -> &dyn Any;

    /// Expose concrete plugin adapters to non-RT control code after transfer.
    fn as_any_mut(&mut self) -> &mut dyn Any;
}
