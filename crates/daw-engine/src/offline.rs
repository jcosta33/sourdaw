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

use crate::float_mode::FlushDenormals;
use crate::midi::diagnostics::active_midi_rt_diagnostics_channel;
use crate::scheduler::{
    graph_progress_channel, meter_channel, transport_position_channel, AudioScheduler,
    GraphCommand, GraphProgressSnapshot, RetiredGraphObjects, TransportPositionSnapshot,
    EFFECT_TABLE_CAPACITY,
};
use crate::timeline::{timeline_rt_diagnostics_channel, TimelineRtDiagnosticsSnapshot};
use rtrb::{Consumer, Producer, RingBuffer};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// The block size an offline render advances by, matching the period the live
/// engine prefers so block-boundary behaviour (device-parameter landings,
/// block-constant fast paths) is exercised on the same grain.
pub const OFFLINE_BLOCK_FRAMES: usize = 512;

/// The control side's hold on one offline render: the request to stop it, and
/// how far it has got.
///
/// Shared between the thread rendering and whoever may cancel it. Both fields
/// are atomics read and written between blocks, never inside one, so a cancel
/// costs the render loop one load per block and a progress read costs the
/// reader nothing it could wait on.
#[derive(Debug, Default)]
pub struct OfflineRenderControl {
    cancelled: AtomicBool,
    rendered_frames: AtomicUsize,
}

impl OfflineRenderControl {
    /// Ask the render to stop at its next block boundary. Idempotent, and
    /// effective even before the render starts.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    /// Frames rendered so far, published after each whole block.
    pub fn rendered_frames(&self) -> usize {
        self.rendered_frames.load(Ordering::Acquire)
    }
}

/// A render that stopped because it was cancelled, with the frames it had
/// rendered whole by then. The partial output is discarded with it: a print
/// cut short is not the batch.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OfflineRenderCancelled {
    pub rendered_frames: usize,
}

/// Why [`OfflineRenderer::push`] refused a command.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OfflineCommandError {
    /// The offline effect table already holds [`EFFECT_TABLE_CAPACITY`] entries.
    EffectTableFull,
    /// The offline command ring has no free slot.
    QueueFull,
}

impl core::fmt::Display for OfflineCommandError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::EffectTableFull => write!(
                f,
                "effect-table-full: the offline render already holds its maximum of \
                 {EFFECT_TABLE_CAPACITY} native devices and plugins"
            ),
            Self::QueueFull => f.write_str("Offline command queue full"),
        }
    }
}

impl std::error::Error for OfflineCommandError {}

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
    /// Effect-table entries the pushed commands register, net of the ones
    /// they retire: the offline counterpart of the live engine's ledger, so a
    /// registration past the table is refused at the push rather than dropped
    /// and counted by the callback.
    effect_registrations: usize,
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
        let (transport_position_tx, _transport_position_reader) = transport_position_channel();
        let (meter_tx, _meter_reader) = meter_channel();
        let scheduler = AudioScheduler::with_rt_diagnostics(
            command_rx,
            retired_tx,
            sample_rate,
            midi_diagnostics_tx,
            timeline_diagnostics_tx,
            graph_progress_tx,
            transport_position_tx,
            meter_tx,
        );

        Self {
            command_tx,
            scheduler,
            retired_rx,
            sample_rate,
            effect_registrations: 0,
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
    ///
    /// Admitted against the effect table first, in push order, exactly as the
    /// live engine admits a batch: the callback can only count a registration
    /// it has no room for, and a render that dropped a device is not the batch.
    pub fn push(&mut self, command: GraphCommand) -> Result<(), OfflineCommandError> {
        let registrations = match command.effect_table_delta() {
            delta if delta > 0 => {
                let admitted = self.effect_registrations + delta.unsigned_abs();
                if admitted > EFFECT_TABLE_CAPACITY {
                    return Err(OfflineCommandError::EffectTableFull);
                }
                admitted
            }
            delta => self
                .effect_registrations
                .saturating_sub(delta.unsigned_abs()),
        };
        self.command_tx
            .push(command)
            .map_err(|_| OfflineCommandError::QueueFull)?;
        self.effect_registrations = registrations;
        Ok(())
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

    /// Where the transport stands, read directly for the same reason
    /// [`Self::graph_progress`] is: this thread is the render thread.
    pub fn transport_position(&self) -> TransportPositionSnapshot {
        self.scheduler.transport_position()
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
        self.render_blocks(&mut left, &mut right, None);
        (left, right)
    }

    /// [`Self::render`], stopping between blocks once `control` is cancelled.
    ///
    /// The cancel is read before every block, the first included, so a render
    /// cancelled before it starts renders nothing. It is never read inside a
    /// block: a block is the scheduler's unit of work, and the live callback
    /// cannot stop halfway through one either.
    pub fn render_controlled(
        &mut self,
        frames: usize,
        control: &OfflineRenderControl,
    ) -> Result<(Vec<f32>, Vec<f32>), OfflineRenderCancelled> {
        let mut left = vec![0.0f32; frames];
        let mut right = vec![0.0f32; frames];
        match self.render_blocks(&mut left, &mut right, Some(control)) {
            Some(cancelled) => Err(cancelled),
            None => Ok((left, right)),
        }
    }

    /// The one render loop. Answers the cancellation that stopped it, or
    /// `None` when every frame rendered.
    fn render_blocks(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        control: Option<&OfflineRenderControl>,
    ) -> Option<OfflineRenderCancelled> {
        // The same float mode the live callback renders under, so a subnormal
        // tail is flushed identically offline and live.
        let _flush_denormals = FlushDenormals::engage();
        let frames = left.len();

        let mut rendered = 0usize;
        while rendered < frames {
            if control.is_some_and(OfflineRenderControl::is_cancelled) {
                return Some(OfflineRenderCancelled {
                    rendered_frames: rendered,
                });
            }
            let block = (frames - rendered).min(OFFLINE_BLOCK_FRAMES);
            self.scheduler.update_graph();
            self.scheduler.process_block(
                &mut left[rendered..rendered + block],
                &mut right[rendered..rendered + block],
                block,
            );
            while self.retired_rx.pop().is_ok() {}
            rendered += block;
            if let Some(control) = control {
                control.rendered_frames.store(rendered, Ordering::Release);
            }
        }

        None
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
                    vec![0.5; 1024].into(),
                    vec![0.5; 1024].into(),
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
                    vec![1.0; 8].into(),
                    [].into(),
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

    /// Mutation: remove the `FlushDenormals` guard at the top of
    /// `OfflineRenderer::render_blocks` — the reading inside the plugin loses the
    /// bits.
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    #[test]
    fn an_offline_render_flushes_denormals_and_restores_the_thread_register() {
        use crate::float_mode::test_support::{
            clear_flush_bits, control_bits, control_register_probe, read_control, write, FLUSH,
        };

        let original = clear_flush_bits();
        let before = read_control();
        let mut renderer = OfflineRenderer::new(48_000.0, 4);
        let (probe, readings) = control_register_probe();
        renderer
            .push(GraphCommand::AddPlugin(3, Box::new(probe), None))
            .expect("the batch should fit");
        renderer
            .push(GraphCommand::SetTransport(playing_transport()))
            .expect("the batch should fit");

        renderer.render(OFFLINE_BLOCK_FRAMES * 2);

        assert!(
            readings.calls() > 0,
            "the probe must have processed a block"
        );
        assert_eq!(
            control_bits(readings.last_seen()),
            before | FLUSH,
            "the plugin must process with only the flush bits added to the prior control value"
        );
        assert_eq!(
            read_control(),
            before,
            "the render restores the thread's control register"
        );
        drop(renderer);
        write(original);
    }

    /// A plugin that tells the test it has processed a block, then waits for
    /// the test's word before it returns — so a cancel set by another thread
    /// lands at a block the test can name.
    struct HandshakePlugin {
        processed: std::sync::mpsc::SyncSender<()>,
        resume: std::sync::mpsc::Receiver<()>,
    }

    impl crate::plugin_slot::NativePlugin for HandshakePlugin {
        fn process_audio(&mut self, left: &mut [f32], _right: &mut [f32], _num_samples: usize) {
            left.fill(1.0);
            if self.processed.send(()).is_ok() {
                let _ = self.resume.recv();
            }
        }

        fn name(&self) -> &str {
            "handshake"
        }

        fn as_any(&self) -> &dyn std::any::Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
            self
        }
    }

    /// Mutation: drop the cancel read at the top of `render_blocks`'s loop —
    /// the render runs every block and answers `Ok`.
    #[test]
    fn a_cancel_set_from_another_thread_mid_render_stops_at_the_next_block_boundary() {
        let (processed_tx, processed_rx) = std::sync::mpsc::sync_channel(0);
        let (resume_tx, resume_rx) = std::sync::mpsc::sync_channel(0);
        let control = OfflineRenderControl::default();
        let mut renderer = OfflineRenderer::new(48_000.0, 4);
        renderer
            .push(GraphCommand::AddPlugin(
                3,
                Box::new(HandshakePlugin {
                    processed: processed_tx,
                    resume: resume_rx,
                }),
                None,
            ))
            .expect("the batch should fit");
        renderer
            .push(GraphCommand::SetTransport(playing_transport()))
            .expect("the batch should fit");

        let outcome = std::thread::scope(|scope| {
            let rendering =
                scope.spawn(|| renderer.render_controlled(OFFLINE_BLOCK_FRAMES * 8, &control));
            processed_rx
                .recv()
                .expect("the render processes its first block");
            control.cancel();
            resume_tx
                .send(())
                .expect("the plugin waits inside block one");
            rendering.join().expect("the render thread returns")
        });

        assert_eq!(
            outcome.map(|_| ()),
            Err(OfflineRenderCancelled {
                rendered_frames: OFFLINE_BLOCK_FRAMES
            }),
            "the block in flight finishes, and none after it starts"
        );
        assert_eq!(control.rendered_frames(), OFFLINE_BLOCK_FRAMES);
    }

    #[test]
    fn a_render_cancelled_before_it_starts_renders_nothing() {
        let control = OfflineRenderControl::default();
        control.cancel();
        let mut renderer = OfflineRenderer::new(48_000.0, 4);

        let outcome = renderer.render_controlled(OFFLINE_BLOCK_FRAMES, &control);

        assert_eq!(
            outcome.map(|_| ()),
            Err(OfflineRenderCancelled { rendered_frames: 0 })
        );
    }

    #[test]
    fn an_uncancelled_controlled_render_is_the_plain_render_and_reports_every_frame() {
        let control = OfflineRenderControl::default();
        let render = |controlled: bool| {
            let mut renderer = OfflineRenderer::new(48_000.0, 16);
            for command in clip_and_gain_commands() {
                renderer.push(command).expect("the batch should fit");
            }
            if controlled {
                renderer
                    .render_controlled(1500, &control)
                    .expect("nothing cancelled it")
            } else {
                renderer.render(1500)
            }
        };

        assert_eq!(render(true), render(false));
        assert_eq!(control.rendered_frames(), 1500);
    }

    struct PassThrough;

    impl crate::plugin_slot::NativePlugin for PassThrough {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn name(&self) -> &str {
            "pass-through"
        }

        fn as_any(&self) -> &dyn std::any::Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
            self
        }
    }

    /// Mutation: drop the admission in `push` — the registration past the
    /// table is accepted and the callback drops it.
    #[test]
    fn a_registration_past_the_effect_table_is_refused_at_the_push() {
        let mut renderer = OfflineRenderer::new(48_000.0, EFFECT_TABLE_CAPACITY + 2);
        for id in 0..EFFECT_TABLE_CAPACITY {
            renderer
                .push(GraphCommand::AddPlugin(id, Box::new(PassThrough), None))
                .expect("the table holds its capacity");
        }

        let refusal = renderer
            .push(GraphCommand::AddPlugin(
                EFFECT_TABLE_CAPACITY,
                Box::new(PassThrough),
                None,
            ))
            .expect_err("one past the table must refuse");

        assert_eq!(refusal, OfflineCommandError::EffectTableFull);
        assert_eq!(
            refusal.to_string(),
            format!(
                "effect-table-full: the offline render already holds its maximum of \
                 {EFFECT_TABLE_CAPACITY} native devices and plugins"
            )
        );
        assert_eq!(
            OfflineCommandError::QueueFull.to_string(),
            "Offline command queue full"
        );
        renderer
            .push(GraphCommand::RemovePlugin(0))
            .expect("a removal frees a slot");
        renderer
            .push(GraphCommand::AddPlugin(
                EFFECT_TABLE_CAPACITY,
                Box::new(PassThrough),
                None,
            ))
            .expect("the freed slot admits one more");
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
