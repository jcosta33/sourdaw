use assert_no_alloc::assert_no_alloc;
#[cfg(debug_assertions)]
use assert_no_alloc::AllocDisabler;
use daw_dsp::crumbs::warp::phase_vocoder::PhaseVocoder;
use daw_dsp::crumbs::warp::repitch::{
    bpm_match_ratio, cents_to_ratio, ratio_to_semitones, semitones_to_ratio,
};
use daw_dsp::crumbs::warp::wsola::WsolaProcessor;
use daw_dsp::primitives::time_stretch::{
    validate_process_request, BufferDirection, BypassPolicy, ChannelLayout, ChannelSupport,
    Discontinuity, DiscontinuityKind, DrainRequest, DrainStatus, OutputDurationRatio,
    PlanGeneration, PlaybackRateRatio, PreparationRequest, PreparedTimeStretch, ProcessReport,
    ProcessRequest, ProcessingClass, RatioChange, StreamingTimeStretchProcessor,
    TimeStretchCapabilities, TimeStretchError, TimeStretchPreparer, TimeStretchTiming,
};
use serde::Deserialize;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[cfg(debug_assertions)]
#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

const SAMPLE_RATE_HZ: u32 = 48_000;
const MAX_INPUT_FRAMES: usize = 512;
const MAX_OUTPUT_FRAMES: usize = 128;
const LATENCY_FRAMES: usize = 4;
const MAX_CHANNELS: usize = 2;
const FIXTURE_SAMPLE_RATE_HZ: u32 = 48_000;
const CANONICAL_FIXTURE_FRAMES: usize = FIXTURE_SAMPLE_RATE_HZ as usize * 4;
const TONE_FADE_FRAMES: usize = FIXTURE_SAMPLE_RATE_HZ as usize * 20 / 1_000;
const CHARACTERIZATION_INPUT_FRAMES: usize = 4_096;
const CHARACTERIZATION_DURATION_RATIO: f64 = 1.25;
const PORTABLE_FIXTURE_MAX_ABS_DIFF: f32 = 0.000_05;
// Release optimization changes only the phase-vocoder accumulation order on
// the reference aarch64 target. Keep its measured delta and allowance local.
const PHASE_VOCODER_RELEASE_OBSERVED_MAX_ABS_DIFF: f32 = 0.000_297_248_36;
const PHASE_VOCODER_RELEASE_MAX_ABS_DIFF: f32 = 0.000_35;

fn ratio(value: f64) -> PlaybackRateRatio {
    PlaybackRateRatio::new(value).expect("test ratio must be valid")
}

fn generation(value: u64) -> PlanGeneration {
    PlanGeneration::new(value).expect("test generation must be non-zero")
}

fn capabilities(channel_support: ChannelSupport) -> TimeStretchCapabilities {
    TimeStretchCapabilities {
        min_sample_rate_hz: 44_100,
        max_sample_rate_hz: 96_000,
        min_input_frames: 1,
        max_input_frames: MAX_INPUT_FRAMES,
        min_output_frames: 1,
        max_output_frames: MAX_OUTPUT_FRAMES,
        channel_support,
        min_playback_rate_ratio: ratio(0.25),
        max_playback_rate_ratio: ratio(4.0),
        processing_class: ProcessingClass::RealtimeStreaming,
        bypass_policy: BypassPolicy::Unsupported,
    }
}

fn preparation_request(
    channel_layout: ChannelLayout,
    plan_generation: PlanGeneration,
) -> PreparationRequest {
    PreparationRequest {
        sample_rate_hz: SAMPLE_RATE_HZ,
        max_input_frames: MAX_INPUT_FRAMES,
        max_output_frames: MAX_OUTPUT_FRAMES,
        channel_layout,
        initial_playback_rate_ratio: ratio(1.0),
        plan_generation,
    }
}

#[derive(Debug)]
struct ProbePreparer {
    capabilities: TimeStretchCapabilities,
    timing: TimeStretchTiming,
}

impl ProbePreparer {
    fn stereo() -> Self {
        Self {
            capabilities: capabilities(ChannelSupport::MonoAndStereo),
            timing: TimeStretchTiming {
                latency_frames: LATENCY_FRAMES,
                tail_frames: LATENCY_FRAMES,
            },
        }
    }
}

impl TimeStretchPreparer for ProbePreparer {
    type Processor = ProbeProcessor;

    fn prepare(
        &mut self,
        request: PreparationRequest,
    ) -> Result<Self::Processor, TimeStretchError> {
        let prepared = PreparedTimeStretch::prepare(self.capabilities, request, self.timing)?;
        Ok(ProbeProcessor::new(prepared))
    }
}

#[derive(Debug)]
struct ProbeProcessor {
    prepared: PreparedTimeStretch,
    delay: [[f32; LATENCY_FRAMES]; MAX_CHANNELS],
    delay_position: usize,
    pending_tail_frames: usize,
    playback_rate_ratio: PlaybackRateRatio,
}

impl ProbeProcessor {
    fn new(prepared: PreparedTimeStretch) -> Self {
        Self {
            playback_rate_ratio: prepared.initial_playback_rate_ratio(),
            prepared,
            delay: [[0.0; LATENCY_FRAMES]; MAX_CHANNELS],
            delay_position: 0,
            pending_tail_frames: 0,
        }
    }

    fn clear_delay(&mut self) {
        for channel in &mut self.delay {
            channel.fill(0.0);
        }
        self.delay_position = 0;
        self.pending_tail_frames = 0;
    }
}

impl StreamingTimeStretchProcessor for ProbeProcessor {
    fn prepared(&self) -> &PreparedTimeStretch {
        &self.prepared
    }

    fn process(
        &mut self,
        request: ProcessRequest<'_, '_>,
    ) -> Result<ProcessReport, TimeStretchError> {
        validate_process_request(&self.prepared, &request)?;

        let input_frames = request.input_frame_count();
        let output_frames = request.output_frame_capacity();
        let channels = request.channel_count();
        let mut ratio_change_index = 0;

        for output_frame in 0..output_frames {
            if let Some(change) = request.ratio_changes.get(ratio_change_index) {
                if change.output_frame_offset == output_frame {
                    self.playback_rate_ratio = change.playback_rate_ratio;
                    ratio_change_index += 1;
                }
            }

            let input_frame =
                (output_frame as u128 * input_frames as u128 / output_frames as u128) as usize;

            for channel in 0..channels {
                let delayed = self.delay[channel][self.delay_position];
                self.delay[channel][self.delay_position] =
                    request.input[channel][input_frame] * self.playback_rate_ratio.get() as f32;
                request.output[channel][output_frame] = delayed;
            }

            self.delay_position += 1;
            if self.delay_position == LATENCY_FRAMES {
                self.delay_position = 0;
            }
        }

        self.pending_tail_frames = LATENCY_FRAMES;
        Ok(ProcessReport {
            consumed_frames: input_frames,
            produced_frames: output_frames,
        })
    }

    fn reset(&mut self, discontinuity: Discontinuity) -> Result<(), TimeStretchError> {
        self.prepared
            .validate_playback_rate_ratio(discontinuity.playback_rate_ratio)?;
        if discontinuity.plan_generation != self.prepared.plan_generation() {
            return Err(TimeStretchError::StalePlan {
                prepared: self.prepared.plan_generation(),
                requested: discontinuity.plan_generation,
            });
        }

        self.clear_delay();
        self.playback_rate_ratio = discontinuity.playback_rate_ratio;
        Ok(())
    }

    fn drain(&mut self, request: DrainRequest<'_>) -> Result<DrainStatus, TimeStretchError> {
        self.prepared.validate_drain_request(&request)?;

        if self.pending_tail_frames == 0 {
            return Ok(DrainStatus::Complete { produced_frames: 0 });
        }

        let produced_frames = self.pending_tail_frames.min(request.frame_capacity());
        for frame in 0..produced_frames {
            for channel in 0..request.channel_count() {
                request.output[channel][frame] = self.delay[channel][self.delay_position];
                self.delay[channel][self.delay_position] = 0.0;
            }
            self.delay_position += 1;
            if self.delay_position == LATENCY_FRAMES {
                self.delay_position = 0;
            }
        }
        self.pending_tail_frames -= produced_frames;

        if self.pending_tail_frames == 0 {
            return Ok(DrainStatus::Complete { produced_frames });
        }
        Ok(DrainStatus::More { produced_frames })
    }
}

fn process_mono_block<P: StreamingTimeStretchProcessor>(
    processor: &mut P,
    input: &[f32],
    output: &mut [f32],
    block_start_frame: u64,
    ratio_changes: &[RatioChange],
) -> Result<ProcessReport, TimeStretchError> {
    let input_channels: [&[f32]; 1] = [input];
    let mut output_channels: [&mut [f32]; 1] = [output];
    let request = ProcessRequest {
        input: &input_channels,
        output: &mut output_channels,
        block_start_frame,
        plan_generation: processor.prepared().plan_generation(),
        ratio_changes,
    };
    processor.process(request)
}

fn assert_finite_drain<P: StreamingTimeStretchProcessor>(processor: &mut P) -> Vec<f32> {
    let mut drained = Vec::new();
    let declared_tail = processor.prepared().timing().tail_frames;

    loop {
        let mut output = [0.0_f32; 2];
        let mut output_channels: [&mut [f32]; 1] = [&mut output];
        let request = DrainRequest {
            output: &mut output_channels,
            plan_generation: processor.prepared().plan_generation(),
        };
        let status = processor.drain(request).expect("probe drain must succeed");
        let produced_frames = status.produced_frames();
        assert!(
            status.is_complete() || produced_frames > 0,
            "an incomplete drain must make forward progress"
        );
        drained.extend_from_slice(&output[..produced_frames]);
        assert!(drained.len() <= declared_tail);

        if status.is_complete() {
            break;
        }
    }

    drained
}

fn assert_streaming_lifecycle_conformance<P>(
    preparer: &mut P,
    request: PreparationRequest,
    input: &[f32],
) where
    P: TimeStretchPreparer,
{
    let mut whole = preparer.prepare(request).expect("whole processor");
    let mut split = preparer.prepare(request).expect("split processor");
    assert_eq!(whole.prepared().timing(), split.prepared().timing());
    assert_eq!(
        whole.prepared().processing_class(),
        ProcessingClass::RealtimeStreaming
    );

    let mut whole_output = vec![0.0_f32; input.len()];
    let mut split_output = vec![0.0_f32; input.len()];
    process_mono_block(&mut whole, input, &mut whole_output, 0, &[]).expect("whole process");
    for (chunk_index, (input_chunk, output_chunk)) in
        input.chunks(8).zip(split_output.chunks_mut(8)).enumerate()
    {
        process_mono_block(
            &mut split,
            input_chunk,
            output_chunk,
            (chunk_index * 8) as u64,
            &[],
        )
        .expect("split process");
    }

    assert_eq!(whole_output, split_output);
    assert_eq!(
        assert_finite_drain(&mut whole),
        assert_finite_drain(&mut split)
    );

    let discontinuity = Discontinuity {
        kind: DiscontinuityKind::Seek,
        next_source_frame: 2_048,
        playback_rate_ratio: ratio(1.0),
        plan_generation: request.plan_generation,
    };
    whole.reset(discontinuity).expect("whole reset");
    split.reset(discontinuity).expect("split reset");
    let mut reset_whole = [0.0_f32; 8];
    let mut reset_split = [0.0_f32; 8];
    process_mono_block(&mut whole, &input[..8], &mut reset_whole, 2_048, &[])
        .expect("post-reset whole process");
    process_mono_block(&mut split, &input[..8], &mut reset_split, 2_048, &[])
        .expect("post-reset split process");
    assert_eq!(reset_whole, reset_split);
}

mod primitives {
    use super::*;

    pub mod contract {
        use super::*;

        #[test]
        fn canonical_ratio_has_one_explicit_inverse_adapter() {
            let playback_rate = ratio(2.0);
            assert_eq!(playback_rate.get(), 2.0);
            assert_eq!(playback_rate.output_duration_ratio().get(), 0.5);

            let duration_ratio = OutputDurationRatio::new(2.0).expect("valid duration ratio");
            assert_eq!(duration_ratio.playback_rate_ratio().get(), 0.5);

            assert!(PlaybackRateRatio::new(f64::NAN).is_err());
            assert!(PlaybackRateRatio::new(0.0).is_err());
            assert!(PlaybackRateRatio::new(0.125).is_err());
            assert!(OutputDurationRatio::new(f64::INFINITY).is_err());
        }

        #[test]
        fn canonical_ratio_extremes_allow_asymmetric_input_and_output_frame_counts() {
            let mut preparer = ProbePreparer::stereo();

            let mut quarter_speed_request =
                preparation_request(ChannelLayout::Mono, generation(30));
            quarter_speed_request.initial_playback_rate_ratio = ratio(0.25);
            let mut quarter_speed = preparer
                .prepare(quarter_speed_request)
                .expect("quarter-speed preparation");
            let quarter_speed_input = [1.0_f32; 32];
            let mut quarter_speed_output = [0.0_f32; 128];
            let quarter_speed_report = process_mono_block(
                &mut quarter_speed,
                &quarter_speed_input,
                &mut quarter_speed_output,
                0,
                &[],
            );

            let mut four_times_request = preparation_request(ChannelLayout::Mono, generation(31));
            four_times_request.initial_playback_rate_ratio = ratio(4.0);
            let mut four_times = preparer
                .prepare(four_times_request)
                .expect("four-times preparation");
            let four_times_input = [1.0_f32; 512];
            let mut four_times_output = [0.0_f32; 128];
            let four_times_report = process_mono_block(
                &mut four_times,
                &four_times_input,
                &mut four_times_output,
                128,
                &[],
            );

            assert_eq!(
                quarter_speed_report,
                Ok(ProcessReport {
                    consumed_frames: 32,
                    produced_frames: 128,
                })
            );
            assert_eq!(
                four_times_report,
                Ok(ProcessReport {
                    consumed_frames: 512,
                    produced_frames: 128,
                })
            );
        }

        #[test]
        fn preparation_validates_sample_rate_block_channel_ratio_and_generation() {
            let caps = capabilities(ChannelSupport::MonoOnly);
            let timing = TimeStretchTiming {
                latency_frames: 0,
                tail_frames: 0,
            };

            let valid = preparation_request(ChannelLayout::Mono, generation(1));
            assert!(PreparedTimeStretch::prepare(caps, valid, timing).is_ok());

            let mut unsupported_rate = valid;
            unsupported_rate.sample_rate_hz = 192_000;
            assert!(matches!(
                PreparedTimeStretch::prepare(caps, unsupported_rate, timing),
                Err(TimeStretchError::UnsupportedSampleRate { .. })
            ));

            let mut unsupported_input = valid;
            unsupported_input.max_input_frames = MAX_INPUT_FRAMES + 1;
            assert!(matches!(
                PreparedTimeStretch::prepare(caps, unsupported_input, timing),
                Err(TimeStretchError::UnsupportedFrameCount {
                    buffer: BufferDirection::Input,
                    ..
                })
            ));

            let mut unsupported_output = valid;
            unsupported_output.max_output_frames = MAX_OUTPUT_FRAMES + 1;
            assert!(matches!(
                PreparedTimeStretch::prepare(caps, unsupported_output, timing),
                Err(TimeStretchError::UnsupportedFrameCount {
                    buffer: BufferDirection::Output,
                    ..
                })
            ));

            let mut unsupported_channels = valid;
            unsupported_channels.channel_layout = ChannelLayout::Stereo;
            assert!(matches!(
                PreparedTimeStretch::prepare(caps, unsupported_channels, timing),
                Err(TimeStretchError::UnsupportedChannelCount { .. })
            ));

            let mut unsupported_ratio = valid;
            unsupported_ratio.initial_playback_rate_ratio = ratio(4.0);
            let mut narrow_caps = caps;
            narrow_caps.max_playback_rate_ratio = ratio(2.0);
            assert!(matches!(
                PreparedTimeStretch::prepare(narrow_caps, unsupported_ratio, timing),
                Err(TimeStretchError::UnsupportedPlaybackRateRatio { .. })
            ));

            assert!(PlanGeneration::new(0).is_err());
        }

        #[test]
        fn processing_class_distinguishes_rt_streaming_from_bounded_analysis() {
            let request = preparation_request(ChannelLayout::Mono, generation(2));
            let timing = TimeStretchTiming {
                latency_frames: 0,
                tail_frames: 0,
            };
            let streaming = PreparedTimeStretch::prepare(
                capabilities(ChannelSupport::MonoOnly),
                request,
                timing,
            )
            .expect("streaming descriptor");
            assert_eq!(
                streaming.processing_class(),
                ProcessingClass::RealtimeStreaming
            );
            assert_eq!(streaming.bypass_policy(), BypassPolicy::Unsupported);

            let mut bounded_caps = capabilities(ChannelSupport::MonoOnly);
            bounded_caps.processing_class = ProcessingClass::BoundedWholeBufferAnalysis;
            let bounded = PreparedTimeStretch::prepare(bounded_caps, request, timing)
                .expect("bounded descriptor");
            assert_eq!(
                bounded.processing_class(),
                ProcessingClass::BoundedWholeBufferAnalysis
            );
        }

        #[test]
        fn process_validation_rejects_non_finite_channels_boundaries_and_stale_plans() {
            let mut preparer = ProbePreparer::stereo();
            let mut processor = preparer
                .prepare(preparation_request(ChannelLayout::Stereo, generation(7)))
                .expect("probe preparation");
            let left = [0.25_f32; 8];
            let right = [0.5_f32; 8];
            let input_channels: [&[f32]; 2] = [&left, &right];
            let mut output_left = [0.0_f32; 8];
            let mut output_right = [0.0_f32; 7];
            let mut mismatched_output: [&mut [f32]; 2] = [&mut output_left, &mut output_right];
            let mismatched = ProcessRequest {
                input: &input_channels,
                output: &mut mismatched_output,
                block_start_frame: 0,
                plan_generation: generation(7),
                ratio_changes: &[],
            };
            assert!(matches!(
                processor.process(mismatched),
                Err(TimeStretchError::MismatchedChannelFrames { .. })
            ));

            let short_right = [0.5_f32; 7];
            let mismatched_input_channels: [&[f32]; 2] = [&left, &short_right];
            let mut matched_output_left = [0.0_f32; 8];
            let mut matched_output_right = [0.0_f32; 8];
            let mut matched_output: [&mut [f32]; 2] =
                [&mut matched_output_left, &mut matched_output_right];
            let mismatched_input = ProcessRequest {
                input: &mismatched_input_channels,
                output: &mut matched_output,
                block_start_frame: 0,
                plan_generation: generation(7),
                ratio_changes: &[],
            };
            assert!(matches!(
                processor.process(mismatched_input),
                Err(TimeStretchError::MismatchedChannelFrames { .. })
            ));

            let mut short_output_left = [0.0_f32; 7];
            let mut short_output_right = [0.0_f32; 7];
            let mut short_output: [&mut [f32]; 2] =
                [&mut short_output_left, &mut short_output_right];
            let short_quantum = ProcessRequest {
                input: &input_channels,
                output: &mut short_output,
                block_start_frame: 0,
                plan_generation: generation(7),
                ratio_changes: &[],
            };
            assert!(validate_process_request(processor.prepared(), &short_quantum).is_ok());

            let mono_input: [&[f32]; 1] = [&left];
            let mut mono_output_data = [0.0_f32; 8];
            let mut mono_output: [&mut [f32]; 1] = [&mut mono_output_data];
            let wrong_channels = ProcessRequest {
                input: &mono_input,
                output: &mut mono_output,
                block_start_frame: 0,
                plan_generation: generation(7),
                ratio_changes: &[],
            };
            assert!(matches!(
                processor.process(wrong_channels),
                Err(TimeStretchError::UnsupportedChannelCount { .. })
            ));

            let non_finite_left = [0.0, f32::NAN, 0.0, 0.0];
            let non_finite_right = [0.0_f32; 4];
            let non_finite_input: [&[f32]; 2] = [&non_finite_left, &non_finite_right];
            let mut finite_output_left = [0.0_f32; 4];
            let mut finite_output_right = [0.0_f32; 4];
            let mut finite_output: [&mut [f32]; 2] =
                [&mut finite_output_left, &mut finite_output_right];
            let non_finite = ProcessRequest {
                input: &non_finite_input,
                output: &mut finite_output,
                block_start_frame: 0,
                plan_generation: generation(7),
                ratio_changes: &[],
            };
            assert!(matches!(
                processor.process(non_finite),
                Err(TimeStretchError::NonFiniteInput {
                    channel: 0,
                    frame: 1
                })
            ));

            let mut output_left = [0.0_f32; 8];
            let mut output_right = [0.0_f32; 8];
            let mut output_channels: [&mut [f32]; 2] = [&mut output_left, &mut output_right];
            let stale = ProcessRequest {
                input: &input_channels,
                output: &mut output_channels,
                block_start_frame: 0,
                plan_generation: generation(8),
                ratio_changes: &[],
            };
            assert!(matches!(
                processor.process(stale),
                Err(TimeStretchError::StalePlan { .. })
            ));

            let changes = [
                RatioChange {
                    output_frame_offset: 5,
                    playback_rate_ratio: ratio(1.5),
                },
                RatioChange {
                    output_frame_offset: 4,
                    playback_rate_ratio: ratio(0.75),
                },
            ];
            let mut output_left = [0.0_f32; 8];
            let mut output_right = [0.0_f32; 8];
            let mut output_channels: [&mut [f32]; 2] = [&mut output_left, &mut output_right];
            let unordered = ProcessRequest {
                input: &input_channels,
                output: &mut output_channels,
                block_start_frame: 0,
                plan_generation: generation(7),
                ratio_changes: &changes,
            };
            assert!(matches!(
                processor.process(unordered),
                Err(TimeStretchError::InvalidRatioBoundary { index: 1, .. })
            ));
        }

        #[test]
        fn process_validation_enforces_independent_prepared_frame_limits() {
            let mut preparer = ProbePreparer::stereo();
            let processor = preparer
                .prepare(preparation_request(ChannelLayout::Mono, generation(8)))
                .expect("probe preparation");

            let excessive_input = [0.0_f32; MAX_INPUT_FRAMES + 1];
            let excessive_input_channels: [&[f32]; 1] = [&excessive_input];
            let mut valid_output = [0.0_f32; MAX_OUTPUT_FRAMES];
            let mut valid_output_channels: [&mut [f32]; 1] = [&mut valid_output];
            let input_overflow = ProcessRequest {
                input: &excessive_input_channels,
                output: &mut valid_output_channels,
                block_start_frame: 0,
                plan_generation: generation(8),
                ratio_changes: &[],
            };
            assert!(matches!(
                validate_process_request(processor.prepared(), &input_overflow),
                Err(TimeStretchError::UnsupportedFrameCount {
                    buffer: BufferDirection::Input,
                    requested: 513,
                    max: 512,
                    ..
                })
            ));

            let valid_input = [0.0_f32; MAX_INPUT_FRAMES];
            let valid_input_channels: [&[f32]; 1] = [&valid_input];
            let mut excessive_output = [0.0_f32; MAX_OUTPUT_FRAMES + 1];
            let mut excessive_output_channels: [&mut [f32]; 1] = [&mut excessive_output];
            let output_overflow = ProcessRequest {
                input: &valid_input_channels,
                output: &mut excessive_output_channels,
                block_start_frame: 0,
                plan_generation: generation(8),
                ratio_changes: &[],
            };
            assert!(matches!(
                validate_process_request(processor.prepared(), &output_overflow),
                Err(TimeStretchError::UnsupportedFrameCount {
                    buffer: BufferDirection::Output,
                    requested: 129,
                    max: 128,
                    ..
                })
            ));
        }

        #[test]
        fn drain_requires_positive_capacity_for_finite_progress() {
            let mut preparer = ProbePreparer::stereo();
            let processor = preparer
                .prepare(preparation_request(ChannelLayout::Stereo, generation(9)))
                .expect("probe preparation");
            let mut empty_left = [];
            let mut empty_right = [];
            let mut empty_output: [&mut [f32]; 2] = [&mut empty_left, &mut empty_right];
            let request = DrainRequest {
                output: &mut empty_output,
                plan_generation: generation(9),
            };

            assert!(matches!(
                processor.prepared().validate_drain_request(&request),
                Err(TimeStretchError::ZeroDrainCapacity)
            ));
        }

        #[test]
        fn ratio_changes_apply_at_exact_output_frame_boundaries() {
            let mut preparer = ProbePreparer::stereo();
            let mut processor = preparer
                .prepare(preparation_request(ChannelLayout::Mono, generation(10)))
                .expect("probe preparation");

            let longer_input = [1.0_f32; 12];
            let longer_input_channels: [&[f32]; 1] = [&longer_input];
            let mut shorter_output = [0.0_f32; 8];
            let mut shorter_output_channels: [&mut [f32]; 1] = [&mut shorter_output];
            let outside_output_quantum = [RatioChange {
                output_frame_offset: 8,
                playback_rate_ratio: ratio(2.0),
            }];
            let invalid_boundary = ProcessRequest {
                input: &longer_input_channels,
                output: &mut shorter_output_channels,
                block_start_frame: 0,
                plan_generation: generation(10),
                ratio_changes: &outside_output_quantum,
            };
            assert_eq!(
                validate_process_request(processor.prepared(), &invalid_boundary),
                Err(TimeStretchError::InvalidRatioBoundary {
                    index: 0,
                    output_frame_offset: 8,
                    output_frame_count: 8,
                })
            );

            let input = [1.0_f32; 8];
            let mut output = [0.0_f32; 12];
            let changes = [RatioChange {
                output_frame_offset: 4,
                playback_rate_ratio: ratio(2.0),
            }];

            process_mono_block(&mut processor, &input, &mut output, 0, &changes)
                .expect("probe process");

            assert_eq!(output[..4], [0.0; 4]);
            assert_eq!(output[4..8], [1.0; 4]);
            assert_eq!(output[8..], [2.0; 4]);
        }

        #[test]
        fn block_splits_reset_latency_and_finite_drain_are_deterministic() {
            let input: Vec<f32> = (0..32).map(|frame| frame as f32 / 32.0).collect();
            let mut preparer = ProbePreparer::stereo();
            let request = preparation_request(ChannelLayout::Mono, generation(11));
            assert_streaming_lifecycle_conformance(&mut preparer, request, &input);
        }
    }

    pub mod assert_no_alloc {
        use super::*;

        #[test]
        fn prepared_process_reset_and_drain_invocation_shape_does_not_allocate() {
            let mut preparer = ProbePreparer::stereo();
            let mut processor = preparer
                .prepare(preparation_request(ChannelLayout::Stereo, generation(21)))
                .expect("probe preparation");
            let left = [0.25_f32; MAX_INPUT_FRAMES];
            let right = [0.5_f32; MAX_INPUT_FRAMES];
            let input_channels: [&[f32]; 2] = [&left, &right];
            let mut output_left = [0.0_f32; MAX_OUTPUT_FRAMES];
            let mut output_right = [0.0_f32; MAX_OUTPUT_FRAMES];
            let changes = [RatioChange {
                output_frame_offset: 64,
                playback_rate_ratio: ratio(1.5),
            }];

            assert_no_alloc(|| {
                let mut output_channels: [&mut [f32]; 2] = [&mut output_left, &mut output_right];
                let request = ProcessRequest {
                    input: &input_channels,
                    output: &mut output_channels,
                    block_start_frame: 0,
                    plan_generation: generation(21),
                    ratio_changes: &changes,
                };
                processor.process(request).expect("allocation-free process");

                processor
                    .reset(Discontinuity {
                        kind: DiscontinuityKind::LoopWrap,
                        next_source_frame: 0,
                        playback_rate_ratio: ratio(1.0),
                        plan_generation: generation(21),
                    })
                    .expect("allocation-free reset");

                let mut resumed_output_channels: [&mut [f32]; 2] =
                    [&mut output_left, &mut output_right];
                let resumed = ProcessRequest {
                    input: &input_channels,
                    output: &mut resumed_output_channels,
                    block_start_frame: 0,
                    plan_generation: generation(21),
                    ratio_changes: &[],
                };
                processor
                    .process(resumed)
                    .expect("allocation-free post-reset process");

                let mut drain_left = [0.0_f32; LATENCY_FRAMES];
                let mut drain_right = [0.0_f32; LATENCY_FRAMES];
                let mut drain_channels: [&mut [f32]; 2] = [&mut drain_left, &mut drain_right];
                let drain = DrainRequest {
                    output: &mut drain_channels,
                    plan_generation: generation(21),
                };
                processor.drain(drain).expect("allocation-free drain");
            });
        }
    }
}

#[derive(Debug, Deserialize)]
struct FixtureManifest {
    schema_version: u32,
    digest_algorithm: String,
    sample_encoding: String,
    channel_layout: String,
    provenance: String,
    generation_policy: FixtureGenerationPolicy,
    fixtures: Vec<FixtureManifestEntry>,
}

#[derive(Debug, Deserialize)]
struct FixtureGenerationPolicy {
    exact_byte_regeneration: String,
    reference_target: String,
    reference_rustc_release: String,
    reference_rustc_commit_hash: String,
    reference_os: String,
    reference_os_version: String,
    reference_cpu: String,
    non_reference_verification: String,
    non_reference_max_abs_diff: f32,
}

#[derive(Debug, PartialEq, Eq)]
struct FixtureGenerationEnvironment {
    target: String,
    rustc_release: String,
    rustc_commit_hash: String,
    os: String,
    os_version: String,
    cpu: String,
}

impl FixtureGenerationPolicy {
    fn matches_reference_environment(&self, environment: &FixtureGenerationEnvironment) -> bool {
        self.reference_target == environment.target
            && self.reference_rustc_release == environment.rustc_release
            && self.reference_rustc_commit_hash == environment.rustc_commit_hash
            && self.reference_os == environment.os
            && self.reference_os_version == environment.os_version
            && self.reference_cpu == environment.cpu
    }
}

#[derive(Debug, Deserialize)]
struct FixtureManifestEntry {
    path: String,
    role: String,
    sample_rate_hz: u32,
    channels: usize,
    frames: usize,
    construction: String,
    sha256: String,
    non_reference_max_abs_diff: Option<f32>,
}

#[derive(Debug)]
struct GeneratedFixture {
    path: &'static str,
    role: &'static str,
    sample_rate_hz: u32,
    channels: usize,
    frames: usize,
    samples: Vec<f32>,
}

impl GeneratedFixture {
    fn bytes(&self) -> Vec<u8> {
        samples_to_f32le(&self.samples)
    }
}

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata/time_stretch")
}

fn raised_cosine_fade(frame: usize, total_frames: usize, fade_frames: usize) -> f32 {
    if frame < fade_frames {
        let phase = frame as f32 / (fade_frames - 1) as f32;
        return 0.5 - 0.5 * (std::f32::consts::PI * phase).cos();
    }

    let frames_from_end = total_frames - 1 - frame;
    if frames_from_end < fade_frames {
        let phase = frames_from_end as f32 / (fade_frames - 1) as f32;
        return 0.5 - 0.5 * (std::f32::consts::PI * phase).cos();
    }

    1.0
}

fn tone_fixture(frequency_hz: f32) -> Vec<f32> {
    let amplitude = 10.0_f32.powf(-12.0 / 20.0);
    let mut samples = Vec::with_capacity(CANONICAL_FIXTURE_FRAMES);
    for frame in 0..CANONICAL_FIXTURE_FRAMES {
        let phase = 2.0 * std::f32::consts::PI * frequency_hz * frame as f32
            / FIXTURE_SAMPLE_RATE_HZ as f32;
        let fade = raised_cosine_fade(frame, CANONICAL_FIXTURE_FRAMES, TONE_FADE_FRAMES);
        samples.push(amplitude * fade * phase.sin());
    }
    samples
}

fn stereo_tone_fixture() -> Vec<f32> {
    let left = tone_fixture(440.0);
    let right = tone_fixture(880.0);
    let mut samples = Vec::with_capacity(CANONICAL_FIXTURE_FRAMES * 2);
    for frame in 0..CANONICAL_FIXTURE_FRAMES {
        samples.push(left[frame]);
        samples.push(right[frame]);
    }
    samples
}

fn percussive_fixture() -> Vec<f32> {
    const ATTACK_INTERVAL_FRAMES: usize = FIXTURE_SAMPLE_RATE_HZ as usize / 4;
    const ATTACK_LENGTH_FRAMES: usize = FIXTURE_SAMPLE_RATE_HZ as usize / 20;
    const PARTIALS_HZ: [f32; 6] = [180.0, 360.0, 720.0, 1_440.0, 2_880.0, 5_760.0];

    let mut samples = vec![0.0_f32; CANONICAL_FIXTURE_FRAMES];
    for attack in 0..16 {
        let attack_start = attack * ATTACK_INTERVAL_FRAMES;
        for attack_frame in 0..ATTACK_LENGTH_FRAMES {
            let frame = attack_start + attack_frame;
            let time_seconds = attack_frame as f32 / FIXTURE_SAMPLE_RATE_HZ as f32;
            let envelope = (-70.0 * time_seconds).exp();
            let mut partial_sum = 0.0_f32;
            for frequency_hz in PARTIALS_HZ {
                partial_sum += (2.0 * std::f32::consts::PI * frequency_hz * time_seconds).cos();
            }
            samples[frame] += 0.45 * envelope * partial_sum / PARTIALS_HZ.len() as f32;
        }
    }
    samples
}

fn characterization_input() -> Vec<f32> {
    let mut samples = Vec::with_capacity(CHARACTERIZATION_INPUT_FRAMES);
    for frame in 0..CHARACTERIZATION_INPUT_FRAMES {
        let time_seconds = frame as f32 / FIXTURE_SAMPLE_RATE_HZ as f32;
        let fade = raised_cosine_fade(frame, CHARACTERIZATION_INPUT_FRAMES, 128);
        let fundamental = (2.0 * std::f32::consts::PI * 440.0 * time_seconds).sin();
        let overtone = (2.0 * std::f32::consts::PI * 660.0 * time_seconds).sin();
        samples.push(fade * (0.2 * fundamental + 0.1 * overtone));
    }
    samples
}

fn generated_fixture_corpus() -> Vec<GeneratedFixture> {
    let mono_440 = tone_fixture(440.0);
    let mono_880 = tone_fixture(880.0);
    let stereo = stereo_tone_fixture();
    let percussive = percussive_fixture();
    let characterization_input = characterization_input();
    let phase_vocoder_output =
        PhaseVocoder::new().process(&characterization_input, CHARACTERIZATION_DURATION_RATIO);
    let wsola_output =
        WsolaProcessor::new().process(&characterization_input, CHARACTERIZATION_DURATION_RATIO);

    vec![
        GeneratedFixture {
            path: "canonical/mono_440hz.f32le",
            role: "canonical-input",
            sample_rate_hz: FIXTURE_SAMPLE_RATE_HZ,
            channels: 1,
            frames: CANONICAL_FIXTURE_FRAMES,
            samples: mono_440,
        },
        GeneratedFixture {
            path: "canonical/mono_880hz.f32le",
            role: "canonical-input",
            sample_rate_hz: FIXTURE_SAMPLE_RATE_HZ,
            channels: 1,
            frames: CANONICAL_FIXTURE_FRAMES,
            samples: mono_880,
        },
        GeneratedFixture {
            path: "canonical/stereo_440_880hz.f32le",
            role: "canonical-input",
            sample_rate_hz: FIXTURE_SAMPLE_RATE_HZ,
            channels: 2,
            frames: CANONICAL_FIXTURE_FRAMES,
            samples: stereo,
        },
        GeneratedFixture {
            path: "canonical/percussive_16_attacks.f32le",
            role: "canonical-input",
            sample_rate_hz: FIXTURE_SAMPLE_RATE_HZ,
            channels: 1,
            frames: CANONICAL_FIXTURE_FRAMES,
            samples: percussive,
        },
        GeneratedFixture {
            path: "characterization/crumbs_input_4096.f32le",
            role: "crumbs-characterization-input",
            sample_rate_hz: FIXTURE_SAMPLE_RATE_HZ,
            channels: 1,
            frames: CHARACTERIZATION_INPUT_FRAMES,
            samples: characterization_input,
        },
        GeneratedFixture {
            path: "characterization/phase_vocoder_duration_ratio_1_25.f32le",
            role: "crumbs-characterization-output",
            sample_rate_hz: FIXTURE_SAMPLE_RATE_HZ,
            channels: 1,
            frames: phase_vocoder_output.len(),
            samples: phase_vocoder_output,
        },
        GeneratedFixture {
            path: "characterization/wsola_duration_ratio_1_25.f32le",
            role: "crumbs-characterization-output",
            sample_rate_hz: FIXTURE_SAMPLE_RATE_HZ,
            channels: 1,
            frames: wsola_output.len(),
            samples: wsola_output,
        },
    ]
}

fn samples_to_f32le(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * std::mem::size_of::<f32>());
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn f32le_to_samples(bytes: &[u8]) -> Vec<f32> {
    assert_eq!(bytes.len() % std::mem::size_of::<f32>(), 0);
    bytes
        .chunks_exact(std::mem::size_of::<f32>())
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    const INITIAL: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    const ROUND: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let bit_length = (bytes.len() as u64) * 8;
    let mut padded = Vec::with_capacity(bytes.len() + 72);
    padded.extend_from_slice(bytes);
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_length.to_be_bytes());

    let mut hash = INITIAL;
    for block in padded.chunks_exact(64) {
        let mut schedule = [0_u32; 64];
        for (index, word) in block.chunks_exact(4).enumerate() {
            schedule[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for index in 16..64 {
            let sigma_zero = schedule[index - 15].rotate_right(7)
                ^ schedule[index - 15].rotate_right(18)
                ^ (schedule[index - 15] >> 3);
            let sigma_one = schedule[index - 2].rotate_right(17)
                ^ schedule[index - 2].rotate_right(19)
                ^ (schedule[index - 2] >> 10);
            schedule[index] = schedule[index - 16]
                .wrapping_add(sigma_zero)
                .wrapping_add(schedule[index - 7])
                .wrapping_add(sigma_one);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = hash;
        for index in 0..64 {
            let choice = (e & f) ^ ((!e) & g);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let sum_zero = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let sum_one = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let first = h
                .wrapping_add(sum_one)
                .wrapping_add(choice)
                .wrapping_add(ROUND[index])
                .wrapping_add(schedule[index]);
            let second = sum_zero.wrapping_add(majority);

            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(first);
            d = c;
            c = b;
            b = a;
            a = first.wrapping_add(second);
        }

        hash[0] = hash[0].wrapping_add(a);
        hash[1] = hash[1].wrapping_add(b);
        hash[2] = hash[2].wrapping_add(c);
        hash[3] = hash[3].wrapping_add(d);
        hash[4] = hash[4].wrapping_add(e);
        hash[5] = hash[5].wrapping_add(f);
        hash[6] = hash[6].wrapping_add(g);
        hash[7] = hash[7].wrapping_add(h);
    }

    let mut digest = String::with_capacity(64);
    for word in hash {
        write!(&mut digest, "{word:08x}").expect("writing to String cannot fail");
    }
    digest
}

fn read_manifest() -> FixtureManifest {
    let path = fixture_root().join("manifest.json");
    let json = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    serde_json::from_str(&json).expect("fixture manifest must be valid JSON")
}

fn command_stdout(program: &str, arguments: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program)
        .args(arguments)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    Some(stdout.trim().to_owned())
}

fn rustc_metadata_value(output: &str, key: &str) -> Option<String> {
    for line in output.lines() {
        let Some((candidate_key, value)) = line.split_once(": ") else {
            continue;
        };
        if candidate_key == key {
            return Some(value.to_owned());
        }
    }
    None
}

fn current_fixture_generation_environment() -> Option<FixtureGenerationEnvironment> {
    if !cfg!(all(
        target_arch = "aarch64",
        target_vendor = "apple",
        target_os = "macos"
    )) {
        return None;
    }

    let rustc = command_stdout("rustc", &["--version", "--verbose"])?;
    Some(FixtureGenerationEnvironment {
        target: rustc_metadata_value(&rustc, "host")?,
        rustc_release: rustc_metadata_value(&rustc, "release")?,
        rustc_commit_hash: rustc_metadata_value(&rustc, "commit-hash")?,
        os: command_stdout("sw_vers", &["-productName"])?,
        os_version: command_stdout("sw_vers", &["-productVersion"])?,
        cpu: command_stdout("sysctl", &["-n", "machdep.cpu.brand_string"])?,
    })
}

fn assert_reference_generation_environment(policy: &FixtureGenerationPolicy) {
    let environment = current_fixture_generation_environment().unwrap_or_else(|| {
        panic!("fixture regeneration requires the declared reference environment: {policy:?}")
    });
    assert!(
        policy.matches_reference_environment(&environment),
        "fixture regeneration environment mismatch: expected {policy:?}, actual {environment:?}"
    );
}

fn read_fixture_samples(path: &Path) -> Vec<f32> {
    let bytes =
        fs::read(path).unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    f32le_to_samples(&bytes)
}

fn observed_max_abs_diff(actual: &[f32], expected: &[f32], label: &str) -> f32 {
    assert_eq!(actual.len(), expected.len(), "{label} frame count");
    let mut observed_max_abs_diff = 0.0_f32;
    for (actual_sample, expected_sample) in actual.iter().zip(expected) {
        assert!(actual_sample.is_finite(), "{label} emitted non-finite data");
        assert!(
            expected_sample.is_finite(),
            "{label} fixture contains non-finite data"
        );
        let difference = (actual_sample - expected_sample).abs();
        if difference > observed_max_abs_diff {
            observed_max_abs_diff = difference;
        }
    }
    observed_max_abs_diff
}

fn assert_samples_match(actual: &[f32], expected: &[f32], allowed_max_abs_diff: f32, label: &str) {
    let observed_max_abs_diff = observed_max_abs_diff(actual, expected, label);
    assert!(
        observed_max_abs_diff <= allowed_max_abs_diff,
        "{label} max absolute difference {observed_max_abs_diff} exceeds portable fixture tolerance {allowed_max_abs_diff}"
    );
}

#[test]
fn time_stretch_fixture_manifest_sha256_matches_known_vector() {
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn time_stretch_fixture_manifest_declares_portable_generation_policy() {
    let manifest = read_manifest();
    let policy = &manifest.generation_policy;

    assert_eq!(policy.exact_byte_regeneration, "reference-environment-only");
    assert_eq!(policy.reference_target, "aarch64-apple-darwin");
    assert_eq!(policy.reference_rustc_release, "1.97.0-nightly");
    assert_eq!(
        policy.reference_rustc_commit_hash,
        "17584a181979f04f2aaad867332c22db1caa511a"
    );
    assert_eq!(policy.reference_os, "macOS");
    assert_eq!(policy.reference_os_version, "26.5.2");
    assert_eq!(policy.reference_cpu, "Apple M4 Pro");
    assert_eq!(
        policy.non_reference_verification,
        "checked-in-sha256-plus-finite-shape-and-sample-tolerance"
    );
    assert_eq!(
        policy.non_reference_max_abs_diff,
        PORTABLE_FIXTURE_MAX_ABS_DIFF
    );
    let tolerance_overrides = manifest
        .fixtures
        .iter()
        .filter_map(|entry| {
            entry
                .non_reference_max_abs_diff
                .map(|tolerance| (entry.path.as_str(), tolerance))
        })
        .collect::<Vec<_>>();
    assert_eq!(
        tolerance_overrides,
        vec![(
            "characterization/phase_vocoder_duration_ratio_1_25.f32le",
            PHASE_VOCODER_RELEASE_MAX_ABS_DIFF,
        )]
    );
    assert!(
        PHASE_VOCODER_RELEASE_OBSERVED_MAX_ABS_DIFF
            <= PHASE_VOCODER_RELEASE_MAX_ABS_DIFF
    );

    let non_reference_environment = FixtureGenerationEnvironment {
        target: policy.reference_target.clone(),
        rustc_release: policy.reference_rustc_release.clone(),
        rustc_commit_hash: policy.reference_rustc_commit_hash.clone(),
        os: policy.reference_os.clone(),
        os_version: policy.reference_os_version.clone(),
        cpu: "different CPU".to_owned(),
    };
    assert!(!policy.matches_reference_environment(&non_reference_environment));
}

#[test]
fn time_stretch_fixture_manifest_validates_hashes_and_portable_semantics() {
    let manifest = read_manifest();
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.digest_algorithm, "sha256");
    assert_eq!(manifest.sample_encoding, "ieee754-f32-le");
    assert_eq!(manifest.channel_layout, "interleaved");
    assert!(manifest.provenance.contains("in-house synthetic"));

    let exact_reference_environment =
        current_fixture_generation_environment().is_some_and(|environment| {
            manifest
                .generation_policy
                .matches_reference_environment(&environment)
        });
    let generated = generated_fixture_corpus();
    let second_reference_generation = if exact_reference_environment {
        Some(generated_fixture_corpus())
    } else {
        None
    };
    assert_eq!(manifest.fixtures.len(), 7);
    assert_eq!(manifest.fixtures.len(), generated.len());

    for (index, (fixture, entry)) in generated.iter().zip(&manifest.fixtures).enumerate() {
        assert_eq!(fixture.path, entry.path);
        assert_eq!(fixture.role, entry.role);
        assert_eq!(fixture.sample_rate_hz, entry.sample_rate_hz);
        assert_eq!(fixture.channels, entry.channels);
        assert_eq!(fixture.frames, entry.frames);
        assert!(!entry.construction.is_empty());

        let checked_in_bytes =
            fs::read(fixture_root().join(fixture.path)).expect("checked-in fixture");
        assert_eq!(
            checked_in_bytes.len(),
            entry.frames * entry.channels * std::mem::size_of::<f32>()
        );
        assert_eq!(sha256_hex(&checked_in_bytes), entry.sha256);

        let checked_in_samples = f32le_to_samples(&checked_in_bytes);
        assert_samples_match(
            &fixture.samples,
            &checked_in_samples,
            entry
                .non_reference_max_abs_diff
                .unwrap_or(manifest.generation_policy.non_reference_max_abs_diff),
            fixture.path,
        );

        if exact_reference_environment {
            let second_fixture = &second_reference_generation
                .as_ref()
                .expect("reference generation")[index];
            assert_eq!(second_fixture.path, fixture.path);

            let first_bytes = fixture.bytes();
            let second_bytes = second_fixture.bytes();
            assert_eq!(first_bytes, second_bytes, "{} repeated bytes", fixture.path);
            assert_eq!(
                first_bytes, checked_in_bytes,
                "{} exact bytes",
                fixture.path
            );
            assert_eq!(sha256_hex(&first_bytes), entry.sha256);
            assert_eq!(sha256_hex(&second_bytes), entry.sha256);
        }
    }
}

#[test]
fn time_stretch_crumbs_baseline_matches_bounded_characterizations() {
    let root = fixture_root();
    let manifest = read_manifest();
    let input = read_fixture_samples(&root.join("characterization/crumbs_input_4096.f32le"));
    let expected_phase = read_fixture_samples(
        &root.join("characterization/phase_vocoder_duration_ratio_1_25.f32le"),
    );
    let expected_wsola =
        read_fixture_samples(&root.join("characterization/wsola_duration_ratio_1_25.f32le"));

    let actual_phase = PhaseVocoder::new().process(&input, CHARACTERIZATION_DURATION_RATIO);
    let actual_wsola = WsolaProcessor::new().process(&input, CHARACTERIZATION_DURATION_RATIO);
    let recorded_release_environment = !cfg!(debug_assertions)
        && current_fixture_generation_environment().is_some_and(|environment| {
            manifest
                .generation_policy
                .matches_reference_environment(&environment)
        });
    if recorded_release_environment {
        assert_eq!(
            observed_max_abs_diff(&actual_phase, &expected_phase, "Crumbs phase vocoder"),
            PHASE_VOCODER_RELEASE_OBSERVED_MAX_ABS_DIFF
        );
    }
    assert_samples_match(
        &actual_phase,
        &expected_phase,
        PHASE_VOCODER_RELEASE_MAX_ABS_DIFF,
        "Crumbs phase vocoder",
    );
    assert_samples_match(
        &actual_wsola,
        &expected_wsola,
        PORTABLE_FIXTURE_MAX_ABS_DIFF,
        "Crumbs WSOLA",
    );

    assert_eq!(semitones_to_ratio(12.0), 2.0);
    assert_eq!(cents_to_ratio(1_200.0), 2.0);
    assert_eq!(ratio_to_semitones(0.5), -12.0);
    assert_eq!(bpm_match_ratio(120.0, 90.0), 0.75);
    assert_eq!(bpm_match_ratio(0.0, 90.0), 1.0);
}

#[test]
#[ignore = "reference-environment fixture regeneration only"]
fn regenerate_time_stretch_fixtures() {
    let root = fixture_root();
    let manifest = read_manifest();
    assert_reference_generation_environment(&manifest.generation_policy);
    for fixture in generated_fixture_corpus() {
        let path = root.join(fixture.path);
        fs::create_dir_all(path.parent().expect("fixture parent")).expect("fixture directory");
        let bytes = fixture.bytes();
        fs::write(&path, &bytes).expect("fixture write");
        println!(
            "{} frames={} channels={} sha256={}",
            fixture.path,
            fixture.frames,
            fixture.channels,
            sha256_hex(&bytes)
        );
    }
}

#[test]
#[ignore = "nonbinding hardware-labelled characterization only"]
fn time_stretch_crumbs_characterization_cpu() {
    assert!(
        !cfg!(debug_assertions),
        "CPU characterization requires an optimized release build"
    );
    let hardware_label = std::env::var("SOURDAW_CPU_LABEL")
        .expect("SOURDAW_CPU_LABEL must identify the measurement hardware");
    let input = characterization_input();
    let mut phase_timings = Vec::with_capacity(5);
    let mut wsola_timings = Vec::with_capacity(5);

    for _ in 0..5 {
        let phase_start = Instant::now();
        let phase = PhaseVocoder::new().process(&input, CHARACTERIZATION_DURATION_RATIO);
        phase_timings.push(phase_start.elapsed().as_micros());
        std::hint::black_box(phase);

        let wsola_start = Instant::now();
        let wsola = WsolaProcessor::new().process(&input, CHARACTERIZATION_DURATION_RATIO);
        wsola_timings.push(wsola_start.elapsed().as_micros());
        std::hint::black_box(wsola);
    }

    phase_timings.sort_unstable();
    wsola_timings.sort_unstable();
    println!(
        "hardware={hardware_label}; profile=release; input_frames={CHARACTERIZATION_INPUT_FRAMES}; duration_ratio={CHARACTERIZATION_DURATION_RATIO}; runs=5; phase_vocoder_median_us={}; wsola_median_us={}",
        phase_timings[2], wsola_timings[2]
    );
}
