//! Deterministic offline rendering: the scheduler without a device.
//!
//! An [`OfflineRenderer`] is the same [`AudioScheduler`] the render callback
//! drives, built over the same command ring, with the caller's loop standing in
//! for the device: no stream, no negotiation, no wall clock. That identity is
//! the point — it makes this the null-test oracle for the native
//! `AudioGraphBackend`: the same command batch rendered here and played live
//! goes through one graph implementation, so a difference between the two is a
//! transport defect, not a second renderer drifting.
//!
//! Determinism holds by construction: the graph addresses everything in
//! absolute timeline frames, the command ring is drained at block boundaries,
//! and nothing here reads a clock or a device. The same commands over the same
//! frame count produce bit-identical output.

use crate::midi::diagnostics::active_midi_rt_diagnostics_channel;
use crate::scheduler::{
    graph_progress_channel, AudioScheduler, GraphCommand, GraphProgressSnapshot,
    RetiredGraphObjects,
};
use crate::timeline::{timeline_rt_diagnostics_channel, TimelineRtDiagnosticsSnapshot};
use rtrb::{Consumer, Producer, RingBuffer};

/// The block size an offline render advances by, matching the period the live
/// engine prefers so block-boundary behaviour (device-parameter landings,
/// block-constant fast paths) is exercised on the same grain.
pub const OFFLINE_BLOCK_FRAMES: usize = 512;

/// The scheduler, a command ring, and a render loop — and no audio stream.
///
/// Field order is drop order and is load bearing, exactly as `AppState`'s is:
/// the command producer must go first so the scheduler's shutdown retirement,
/// which drains the command ring until it is abandoned, finds it abandoned;
/// the retirement consumer goes last so everything the scheduler hands back
/// (including its own shutdown retirement) is freed here, on the control
/// thread that owns this value.
pub struct OfflineRenderer {
    command_tx: Producer<GraphCommand>,
    scheduler: AudioScheduler,
    retired_rx: Consumer<RetiredGraphObjects>,
    sample_rate: f32,
}

impl OfflineRenderer {
    /// Build a renderer whose command ring holds `command_capacity` commands.
    ///
    /// The capacity is the caller's whole-batch guarantee: a caller that sizes
    /// it to its validated batch can push every command before the first block
    /// renders, so the graph is never observed half-built.
    pub fn new(sample_rate: f32, command_capacity: usize) -> Self {
        let command_capacity = command_capacity.max(1);
        // The retirement ring's real bound is the command ring: `update_graph`
        // drains the *entire* command ring in one call, every command can
        // produce at most one retirement, and a retirement the ring cannot
        // take makes `update_graph` return early — deferring the rest of the
        // batch past a rendered block and breaking the whole-batch guarantee.
        // One command ring of slots plus the scheduler's reserved shutdown
        // slot therefore always suffices and never defers — the same
        // arithmetic behind the live engine's `RETIREMENT_QUEUE_CAPACITY`
        // (its 256-slot command ring plus one).
        let (command_tx, command_rx) = RingBuffer::new(command_capacity);
        let (retired_tx, retired_rx) = RingBuffer::new(command_capacity + 1);
        let (midi_diagnostics_tx, _midi_diagnostics_reader) = active_midi_rt_diagnostics_channel();
        let (timeline_diagnostics_tx, _timeline_diagnostics_reader) =
            timeline_rt_diagnostics_channel();
        let (graph_progress_tx, _graph_progress_reader) = graph_progress_channel();
        let scheduler = AudioScheduler::with_rt_diagnostics(
            command_rx,
            retired_tx,
            sample_rate,
            midi_diagnostics_tx,
            timeline_diagnostics_tx,
            graph_progress_tx,
        );

        Self {
            command_tx,
            scheduler,
            retired_rx,
            sample_rate,
        }
    }

    pub const fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    /// Free slots on the command ring.
    pub fn command_slots(&self) -> usize {
        self.command_tx.slots()
    }

    /// Queue one command. It reaches the graph at the next block boundary.
    pub fn push(&mut self, command: GraphCommand) -> Result<(), String> {
        self.command_tx
            .push(command)
            .map_err(|_| "Offline command queue full".to_string())
    }

    /// The graph's refusal counters, for callers proving a batch was taken
    /// whole rather than partially dropped.
    pub fn timeline_diagnostics(&self) -> TimelineRtDiagnosticsSnapshot {
        self.scheduler.timeline().diagnostics()
    }

    /// The progress echo the live engine publishes per callback, read
    /// directly here because this thread *is* the render thread — the offline
    /// stand-in for [`crate::EngineHandle::graph_progress_snapshot`], with no
    /// lag by construction. Batches count only when pushed behind a
    /// [`GraphCommand::BeginBatch`] fence, exactly as the live drain counts
    /// them.
    pub fn graph_progress(&self) -> GraphProgressSnapshot {
        self.scheduler.graph_progress()
    }

    /// Render `frames` frames into planar stereo, in
    /// [`OFFLINE_BLOCK_FRAMES`]-sized steps.
    ///
    /// Each block drains the command ring first, exactly as the live callback
    /// does, then renders; retirements are reclaimed here between blocks —
    /// this thread is both the command side and the render side, so freeing is
    /// safe and keeps the retirement ring from stalling the graph.
    pub fn render(&mut self, frames: usize) -> (Vec<f32>, Vec<f32>) {
        let mut left = vec![0.0f32; frames];
        let mut right = vec![0.0f32; frames];

        let mut rendered = 0usize;
        while rendered < frames {
            let block = (frames - rendered).min(OFFLINE_BLOCK_FRAMES);
            self.scheduler.update_graph();
            self.scheduler.process_block(
                &mut left[rendered..rendered + block],
                &mut right[rendered..rendered + block],
                block,
            );
            while self.retired_rx.pop().is_ok() {}
            rendered += block;
        }

        (left, right)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_slot::TransportState;
    use crate::timeline::{
        AutomationEvent, AutomationTarget, AutomationWrite, ClipPlacement, ClipPlayback, RampShape,
        TimelineClip, TimelineTrack,
    };

    fn playing_transport() -> TransportState {
        TransportState {
            is_playing: true,
            ..TransportState::default()
        }
    }

    fn clip_and_gain_commands() -> Vec<GraphCommand> {
        let placement = ClipPlacement {
            start_frame: 0,
            source_offset_frames: 0,
            length_frames: 1024,
        };
        vec![
            GraphCommand::AddTrack(TimelineTrack::new(1)),
            GraphCommand::AddClip(
                1,
                TimelineClip::new(
                    7,
                    vec![0.5; 1024],
                    vec![0.5; 1024],
                    placement,
                    ClipPlayback::at_gain(1.0),
                ),
            ),
            GraphCommand::AutomateParam {
                target: AutomationTarget::TrackGain(1),
                write: AutomationWrite::Replace(AutomationEvent {
                    at_frame: 0,
                    duration_frames: 0,
                    value: 0.5,
                    shape: RampShape::Step,
                }),
            },
            GraphCommand::SetTransport(playing_transport()),
        ]
    }

    #[test]
    fn a_clip_through_a_gain_renders_the_expected_samples() {
        let mut renderer = OfflineRenderer::new(48_000.0, 16);
        for command in clip_and_gain_commands() {
            renderer.push(command).expect("the batch should fit");
        }

        let (left, right) = renderer.render(1024);

        // 0.5 material through a 0.5 fader: audibly nonzero and exactly the
        // product, because unity-rate playback is bit-exact by contract.
        assert!(left.iter().any(|sample| *sample != 0.0));
        assert_eq!(left[0], 0.25);
        assert_eq!(right[100], 0.25);
        assert_eq!(left[1023], 0.25);
    }

    #[test]
    fn the_same_batch_renders_bit_identical_output_twice() {
        let render_once = || {
            let mut renderer = OfflineRenderer::new(48_000.0, 16);
            for command in clip_and_gain_commands() {
                renderer.push(command).expect("the batch should fit");
            }
            renderer.render(2048)
        };

        let (first_left, first_right) = render_once();
        let (second_left, second_right) = render_once();

        assert_eq!(first_left, second_left);
        assert_eq!(first_right, second_right);
    }

    #[test]
    fn a_render_spanning_many_blocks_places_the_clip_on_its_absolute_frames() {
        let mut renderer = OfflineRenderer::new(48_000.0, 16);
        let placement = ClipPlacement {
            // Deliberately not block-aligned: the clip must enter mid-block.
            start_frame: OFFLINE_BLOCK_FRAMES as u64 + 3,
            source_offset_frames: 0,
            length_frames: 8,
        };
        renderer
            .push(GraphCommand::AddTrack(TimelineTrack::new(1)))
            .unwrap();
        renderer
            .push(GraphCommand::AddClip(
                1,
                TimelineClip::new(
                    7,
                    vec![1.0; 8],
                    Vec::new(),
                    placement,
                    ClipPlayback::at_gain(1.0),
                ),
            ))
            .unwrap();
        renderer
            .push(GraphCommand::SetTransport(playing_transport()))
            .unwrap();

        let (left, _right) = renderer.render(OFFLINE_BLOCK_FRAMES * 2);

        assert_eq!(left[OFFLINE_BLOCK_FRAMES + 2], 0.0);
        assert_eq!(left[OFFLINE_BLOCK_FRAMES + 3], 1.0);
        assert_eq!(left[OFFLINE_BLOCK_FRAMES + 10], 1.0);
        assert_eq!(left[OFFLINE_BLOCK_FRAMES + 11], 0.0);
    }

    /// The progress echo's two guarantees, driven synchronously: a fenced
    /// batch counts only once it applied whole, and the playhead field is the
    /// frame the last block reached — the pair the control-side ledger's
    /// release law subtracts against.
    #[test]
    fn graph_progress_counts_fenced_batches_and_reports_the_playhead() {
        let mut renderer = OfflineRenderer::new(48_000.0, 16);
        assert_eq!(renderer.graph_progress(), GraphProgressSnapshot::default());

        let commands = clip_and_gain_commands();
        renderer
            .push(GraphCommand::BeginBatch {
                commands: commands.len(),
            })
            .expect("the fence fits");
        for command in commands {
            renderer.push(command).expect("the batch fits");
        }

        // Nothing counted before a block drains the ring.
        assert_eq!(renderer.graph_progress().batches_applied, 0);

        renderer.render(OFFLINE_BLOCK_FRAMES * 2);

        let progress = renderer.graph_progress();
        assert_eq!(progress.batches_applied, 1);
        assert_eq!(progress.playhead_frame, OFFLINE_BLOCK_FRAMES as u64 * 2);

        // A loose (unfenced) command is not a batch and must not advance the
        // batch horizon the ledger numbers against.
        renderer
            .push(GraphCommand::SeekFrames(0))
            .expect("the loose command fits");
        renderer.render(OFFLINE_BLOCK_FRAMES);
        assert_eq!(renderer.graph_progress().batches_applied, 1);
    }

    #[test]
    fn an_empty_renderer_renders_silence_and_drops_cleanly() {
        let mut renderer = OfflineRenderer::new(48_000.0, 4);

        let (left, right) = renderer.render(1000);

        assert!(left.iter().all(|sample| *sample == 0.0));
        assert!(right.iter().all(|sample| *sample == 0.0));
        drop(renderer);
    }
}
