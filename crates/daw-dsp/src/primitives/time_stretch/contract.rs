use std::error::Error;
use std::fmt::{Display, Formatter};

use super::PlaybackRateRatio;

/// Whether an implementation executes bounded render-thread work or bounded whole-buffer work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessingClass {
    RealtimeStreaming,
    BoundedWholeBufferAnalysis,
}

/// Explicit bypass behavior published by an implementation rather than inferred by a caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BypassPolicy {
    Unsupported,
    DrySignalWithDeclaredLatency,
}

/// Supported channel layouts for the v1 contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelLayout {
    Mono,
    Stereo,
}

impl ChannelLayout {
    pub const fn channel_count(self) -> usize {
        match self {
            Self::Mono => 1,
            Self::Stereo => 2,
        }
    }
}

/// Channel layouts an implementation can prepare.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelSupport {
    MonoOnly,
    MonoAndStereo,
}

impl ChannelSupport {
    pub const fn accepts(self, layout: ChannelLayout) -> bool {
        match self {
            Self::MonoOnly => matches!(layout, ChannelLayout::Mono),
            Self::MonoAndStereo => true,
        }
    }
}

/// Monotonic identity for immutable state prepared off the processing path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct PlanGeneration(u64);

impl PlanGeneration {
    pub fn new(value: u64) -> Result<Self, TimeStretchError> {
        if value == 0 {
            return Err(TimeStretchError::InvalidPlanGeneration { requested: value });
        }
        Ok(Self(value))
    }

    pub const fn get(self) -> u64 {
        self.0
    }
}

/// Explicit ranges and execution class published by an implementation before preparation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TimeStretchCapabilities {
    pub min_sample_rate_hz: u32,
    pub max_sample_rate_hz: u32,
    pub min_block_frames: usize,
    pub max_block_frames: usize,
    pub channel_support: ChannelSupport,
    pub min_playback_rate_ratio: PlaybackRateRatio,
    pub max_playback_rate_ratio: PlaybackRateRatio,
    pub processing_class: ProcessingClass,
    pub bypass_policy: BypassPolicy,
}

impl TimeStretchCapabilities {
    fn validate(self) -> Result<(), TimeStretchError> {
        if self.min_sample_rate_hz == 0 || self.min_sample_rate_hz > self.max_sample_rate_hz {
            return Err(TimeStretchError::InvalidCapabilities);
        }
        if self.min_block_frames == 0 || self.min_block_frames > self.max_block_frames {
            return Err(TimeStretchError::InvalidCapabilities);
        }
        if self.min_playback_rate_ratio > self.max_playback_rate_ratio {
            return Err(TimeStretchError::InvalidCapabilities);
        }
        Ok(())
    }
}

/// Allocation-permitted slow-path request used to construct a processor and its workspaces.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreparationRequest {
    pub sample_rate_hz: u32,
    pub max_block_frames: usize,
    pub channel_layout: ChannelLayout,
    pub initial_playback_rate_ratio: PlaybackRateRatio,
    pub plan_generation: PlanGeneration,
}

/// Stable latency and finite drain bound declared by a prepared implementation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeStretchTiming {
    pub latency_frames: usize,
    pub tail_frames: usize,
}

/// Validated, immutable description of state prepared away from the processing path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreparedTimeStretch {
    capabilities: TimeStretchCapabilities,
    request: PreparationRequest,
    timing: TimeStretchTiming,
}

impl PreparedTimeStretch {
    pub fn prepare(
        capabilities: TimeStretchCapabilities,
        request: PreparationRequest,
        timing: TimeStretchTiming,
    ) -> Result<Self, TimeStretchError> {
        capabilities.validate()?;

        if !(capabilities.min_sample_rate_hz..=capabilities.max_sample_rate_hz)
            .contains(&request.sample_rate_hz)
        {
            return Err(TimeStretchError::UnsupportedSampleRate {
                requested: request.sample_rate_hz,
                min: capabilities.min_sample_rate_hz,
                max: capabilities.max_sample_rate_hz,
            });
        }
        if !(capabilities.min_block_frames..=capabilities.max_block_frames)
            .contains(&request.max_block_frames)
        {
            return Err(TimeStretchError::UnsupportedBlockSize {
                requested: request.max_block_frames,
                min: capabilities.min_block_frames,
                max: capabilities.max_block_frames,
            });
        }
        if !capabilities.channel_support.accepts(request.channel_layout) {
            return Err(TimeStretchError::UnsupportedChannelCount {
                requested: request.channel_layout.channel_count(),
                supported: capabilities.channel_support,
            });
        }

        let prepared = Self {
            capabilities,
            request,
            timing,
        };
        prepared.validate_playback_rate_ratio(request.initial_playback_rate_ratio)?;
        Ok(prepared)
    }

    pub const fn capabilities(&self) -> TimeStretchCapabilities {
        self.capabilities
    }

    pub const fn bypass_policy(&self) -> BypassPolicy {
        self.capabilities.bypass_policy
    }

    pub const fn channel_layout(&self) -> ChannelLayout {
        self.request.channel_layout
    }

    pub const fn initial_playback_rate_ratio(&self) -> PlaybackRateRatio {
        self.request.initial_playback_rate_ratio
    }

    pub const fn plan_generation(&self) -> PlanGeneration {
        self.request.plan_generation
    }

    pub const fn processing_class(&self) -> ProcessingClass {
        self.capabilities.processing_class
    }

    pub const fn sample_rate_hz(&self) -> u32 {
        self.request.sample_rate_hz
    }

    pub const fn timing(&self) -> TimeStretchTiming {
        self.timing
    }

    pub fn validate_playback_rate_ratio(
        &self,
        ratio: PlaybackRateRatio,
    ) -> Result<(), TimeStretchError> {
        if ratio < self.capabilities.min_playback_rate_ratio
            || ratio > self.capabilities.max_playback_rate_ratio
        {
            return Err(TimeStretchError::UnsupportedPlaybackRateRatio {
                requested: ratio.get(),
                min: self.capabilities.min_playback_rate_ratio.get(),
                max: self.capabilities.max_playback_rate_ratio.get(),
            });
        }
        Ok(())
    }

    pub fn validate_drain_request(
        &self,
        request: &DrainRequest<'_>,
    ) -> Result<(), TimeStretchError> {
        self.validate_generation(request.plan_generation)?;
        self.validate_output_channels(request.output)?;
        if request.frame_capacity() == 0 {
            return Err(TimeStretchError::ZeroDrainCapacity);
        }
        Ok(())
    }

    fn validate_generation(&self, requested: PlanGeneration) -> Result<(), TimeStretchError> {
        if requested != self.request.plan_generation {
            return Err(TimeStretchError::StalePlan {
                prepared: self.request.plan_generation,
                requested,
            });
        }
        Ok(())
    }

    fn validate_output_channels(&self, output: &[&mut [f32]]) -> Result<(), TimeStretchError> {
        let expected_channels = self.request.channel_layout.channel_count();
        if output.len() != expected_channels {
            return Err(TimeStretchError::UnsupportedChannelCount {
                requested: output.len(),
                supported: self.capabilities.channel_support,
            });
        }

        let expected_frames = output.first().map_or(0, |channel| channel.len());
        for (channel, samples) in output.iter().enumerate() {
            if samples.len() != expected_frames {
                return Err(TimeStretchError::MismatchedChannelFrames {
                    channel,
                    expected: expected_frames,
                    actual: samples.len(),
                });
            }
        }
        if expected_frames > self.request.max_block_frames {
            return Err(TimeStretchError::UnsupportedBlockSize {
                requested: expected_frames,
                min: 0,
                max: self.request.max_block_frames,
            });
        }
        Ok(())
    }
}

/// A canonical ratio change applied before the sample at `frame_offset` is consumed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RatioChange {
    pub frame_offset: usize,
    pub playback_rate_ratio: PlaybackRateRatio,
}

/// Caller-borrowed render-quantum buffers and immutable prepared-state identity.
pub struct ProcessRequest<'input, 'output> {
    pub input: &'input [&'input [f32]],
    pub output: &'output mut [&'output mut [f32]],
    pub block_start_frame: u64,
    pub plan_generation: PlanGeneration,
    pub ratio_changes: &'input [RatioChange],
}

impl ProcessRequest<'_, '_> {
    pub fn channel_count(&self) -> usize {
        self.input.len()
    }

    pub fn frame_count(&self) -> usize {
        self.input.first().map_or(0, |channel| channel.len())
    }
}

/// Fixed-size accounting returned by one render-quantum invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessReport {
    pub consumed_frames: usize,
    pub produced_frames: usize,
}

/// Caller-owned buffer used to drain the prepared processor's declared finite tail.
pub struct DrainRequest<'output> {
    pub output: &'output mut [&'output mut [f32]],
    pub plan_generation: PlanGeneration,
}

impl DrainRequest<'_> {
    pub fn channel_count(&self) -> usize {
        self.output.len()
    }

    pub fn frame_capacity(&self) -> usize {
        self.output.first().map_or(0, |channel| channel.len())
    }
}

/// Finite progress returned by a drain call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DrainStatus {
    More { produced_frames: usize },
    Complete { produced_frames: usize },
}

impl DrainStatus {
    pub const fn produced_frames(self) -> usize {
        match self {
            Self::More { produced_frames } | Self::Complete { produced_frames } => produced_frames,
        }
    }

    pub const fn is_complete(self) -> bool {
        matches!(self, Self::Complete { .. })
    }
}

/// The reason ordinary stream continuity has been intentionally discarded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscontinuityKind {
    Seek,
    LoopWrap,
    SourceReplacement,
}

/// Deterministic reset request for a seek, loop wrap, or source replacement.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Discontinuity {
    pub kind: DiscontinuityKind,
    pub next_source_frame: u64,
    pub playback_rate_ratio: PlaybackRateRatio,
    pub plan_generation: PlanGeneration,
}

/// Slow-path factory. Allocation and plan construction are allowed only in this phase.
pub trait TimeStretchPreparer {
    type Processor: StreamingTimeStretchProcessor;

    fn prepare(&mut self, request: PreparationRequest)
        -> Result<Self::Processor, TimeStretchError>;
}

/// Caller-buffered, allocation-free streaming invocation surface.
pub trait StreamingTimeStretchProcessor {
    fn prepared(&self) -> &PreparedTimeStretch;

    fn process(
        &mut self,
        request: ProcessRequest<'_, '_>,
    ) -> Result<ProcessReport, TimeStretchError>;

    fn reset(&mut self, discontinuity: Discontinuity) -> Result<(), TimeStretchError>;

    fn drain(&mut self, request: DrainRequest<'_>) -> Result<DrainStatus, TimeStretchError>;
}

/// Validate an RT invocation without allocation, locks, I/O, logging, or handle publication.
pub fn validate_process_request(
    prepared: &PreparedTimeStretch,
    request: &ProcessRequest<'_, '_>,
) -> Result<(), TimeStretchError> {
    prepared.validate_generation(request.plan_generation)?;

    let expected_channels = prepared.channel_layout().channel_count();
    if request.input.len() != expected_channels {
        return Err(TimeStretchError::UnsupportedChannelCount {
            requested: request.input.len(),
            supported: prepared.capabilities.channel_support,
        });
    }
    prepared.validate_output_channels(request.output)?;

    let frame_count = request.frame_count();
    if !(prepared.capabilities.min_block_frames..=prepared.request.max_block_frames)
        .contains(&frame_count)
    {
        return Err(TimeStretchError::UnsupportedBlockSize {
            requested: frame_count,
            min: prepared.capabilities.min_block_frames,
            max: prepared.request.max_block_frames,
        });
    }

    let output_frames = request.output.first().map_or(0, |channel| channel.len());
    if output_frames != frame_count {
        return Err(TimeStretchError::MismatchedInputOutputFrames {
            input_frames: frame_count,
            output_frames,
        });
    }

    for (channel, samples) in request.input.iter().enumerate() {
        if samples.len() != frame_count {
            return Err(TimeStretchError::MismatchedChannelFrames {
                channel,
                expected: frame_count,
                actual: samples.len(),
            });
        }
        for (frame, sample) in samples.iter().enumerate() {
            if !sample.is_finite() {
                return Err(TimeStretchError::NonFiniteInput { channel, frame });
            }
        }
    }

    let mut previous_offset = None;
    for (index, change) in request.ratio_changes.iter().enumerate() {
        let is_out_of_block = change.frame_offset >= frame_count;
        let is_not_strictly_increasing =
            previous_offset.is_some_and(|previous| change.frame_offset <= previous);
        if is_out_of_block || is_not_strictly_increasing {
            return Err(TimeStretchError::InvalidRatioBoundary {
                index,
                frame_offset: change.frame_offset,
                frame_count,
            });
        }
        prepared.validate_playback_rate_ratio(change.playback_rate_ratio)?;
        previous_offset = Some(change.frame_offset);
    }

    Ok(())
}

/// Typed contract failure. Variants carry only fixed-size data so failure construction is RT-safe.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TimeStretchError {
    InvalidCapabilities,
    InvalidPlanGeneration {
        requested: u64,
    },
    UnsupportedSampleRate {
        requested: u32,
        min: u32,
        max: u32,
    },
    UnsupportedBlockSize {
        requested: usize,
        min: usize,
        max: usize,
    },
    UnsupportedChannelCount {
        requested: usize,
        supported: ChannelSupport,
    },
    UnsupportedPlaybackRateRatio {
        requested: f64,
        min: f64,
        max: f64,
    },
    StalePlan {
        prepared: PlanGeneration,
        requested: PlanGeneration,
    },
    MismatchedChannelFrames {
        channel: usize,
        expected: usize,
        actual: usize,
    },
    MismatchedInputOutputFrames {
        input_frames: usize,
        output_frames: usize,
    },
    ZeroDrainCapacity,
    NonFiniteInput {
        channel: usize,
        frame: usize,
    },
    InvalidRatioBoundary {
        index: usize,
        frame_offset: usize,
        frame_count: usize,
    },
}

impl Display for TimeStretchError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "time-stretch contract failure: {self:?}")
    }
}

impl Error for TimeStretchError {}
