pub const MIDI_CLOCK_PPQN: u32 = 24;
pub const MIDI_CLOCK_EVENT_CAPACITY: usize = 128;
const SUBSAMPLE_BITS: u32 = 32;
const SUBSAMPLE_SCALE: u128 = 1u128 << SUBSAMPLE_BITS;
const MAX_PULSE_INTERVAL_TICKS: u128 = u64::MAX as u128;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MidiClockEventKind {
    TimingClock,
    Start,
    Continue,
    Stop,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MidiClockEvent {
    pub sample_offset: usize,
    pub kind: MidiClockEventKind,
}

const EMPTY_MIDI_CLOCK_EVENT: MidiClockEvent = MidiClockEvent {
    sample_offset: 0,
    kind: MidiClockEventKind::TimingClock,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MidiClockEventBuffer {
    events: [MidiClockEvent; MIDI_CLOCK_EVENT_CAPACITY],
    len: usize,
    dropped_event_count: u64,
}

impl MidiClockEventBuffer {
    pub const fn new() -> Self {
        Self {
            events: [EMPTY_MIDI_CLOCK_EVENT; MIDI_CLOCK_EVENT_CAPACITY],
            len: 0,
            dropped_event_count: 0,
        }
    }

    pub fn as_slice(&self) -> &[MidiClockEvent] {
        &self.events[..self.len]
    }

    pub fn iter(&self) -> impl Iterator<Item = &MidiClockEvent> {
        self.as_slice().iter()
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn dropped_event_count(&self) -> u64 {
        self.dropped_event_count
    }

    fn is_full(&self) -> bool {
        self.len == MIDI_CLOCK_EVENT_CAPACITY
    }

    fn push(&mut self, event: MidiClockEvent) {
        if self.is_full() {
            self.dropped_event_count = self.dropped_event_count.saturating_add(1);
            return;
        }

        self.events[self.len] = event;
        self.len += 1;
    }

    fn record_dropped_events(&mut self, count: u64) {
        self.dropped_event_count = self.dropped_event_count.saturating_add(count);
    }
}

impl Default for MidiClockEventBuffer {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MidiClockTransportTransition {
    None,
    Start,
    Continue,
    Stop,
    Seek,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MidiClockBlockInput {
    pub timeline_sample: u64,
    pub block_sample_count: usize,
    pub sample_rate: u32,
    pub tempo_bpm: f64,
    pub transition: MidiClockTransportTransition,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MidiClockError {
    InvalidSampleRate,
    InvalidTempo,
    TimelineOverflow,
    TimelineDiscontinuity {
        expected_sample: u64,
        received_sample: u64,
    },
}

pub struct MidiClock {
    is_playing: bool,
    ticks_until_next_pulse: u128,
    pulse_interval_ticks: Option<u128>,
    expected_timeline_sample: Option<u64>,
}

impl MidiClock {
    pub const fn new() -> Self {
        Self {
            is_playing: false,
            ticks_until_next_pulse: 0,
            pulse_interval_ticks: None,
            expected_timeline_sample: None,
        }
    }

    pub fn process_block(
        &mut self,
        input: MidiClockBlockInput,
    ) -> Result<MidiClockEventBuffer, MidiClockError> {
        let pulse_interval_ticks = Self::pulse_interval_ticks(input)?;
        let block_sample_count = input.block_sample_count as u64;
        let next_timeline_sample = input
            .timeline_sample
            .checked_add(block_sample_count)
            .ok_or(MidiClockError::TimelineOverflow)?;

        self.validate_timeline(input)?;
        self.update_pulse_interval(pulse_interval_ticks);

        let mut output = MidiClockEventBuffer::new();
        self.apply_transition(input.transition, &mut output);

        if self.is_playing {
            self.schedule_pulses(input.block_sample_count, pulse_interval_ticks, &mut output);
        }

        self.expected_timeline_sample = Some(next_timeline_sample);
        Ok(output)
    }

    pub fn is_playing(&self) -> bool {
        self.is_playing
    }

    fn pulse_interval_ticks(input: MidiClockBlockInput) -> Result<u128, MidiClockError> {
        if input.sample_rate == 0 {
            return Err(MidiClockError::InvalidSampleRate);
        }
        if !input.tempo_bpm.is_finite() || input.tempo_bpm <= 0.0 {
            return Err(MidiClockError::InvalidTempo);
        }

        let pulses_per_minute = input.tempo_bpm * MIDI_CLOCK_PPQN as f64;
        let samples_per_pulse = input.sample_rate as f64 * 60.0 / pulses_per_minute;
        if !samples_per_pulse.is_finite() || samples_per_pulse <= 0.0 {
            return Err(MidiClockError::InvalidTempo);
        }

        let interval_ticks = (samples_per_pulse * SUBSAMPLE_SCALE as f64).round();
        if !interval_ticks.is_finite()
            || interval_ticks < 1.0
            || interval_ticks >= MAX_PULSE_INTERVAL_TICKS as f64
        {
            return Err(MidiClockError::InvalidTempo);
        }

        Ok(interval_ticks as u128)
    }

    fn validate_timeline(&self, input: MidiClockBlockInput) -> Result<(), MidiClockError> {
        if matches!(
            input.transition,
            MidiClockTransportTransition::Start | MidiClockTransportTransition::Seek
        ) {
            return Ok(());
        }

        let Some(expected_sample) = self.expected_timeline_sample else {
            return Ok(());
        };
        if input.timeline_sample == expected_sample {
            return Ok(());
        }

        Err(MidiClockError::TimelineDiscontinuity {
            expected_sample,
            received_sample: input.timeline_sample,
        })
    }

    fn update_pulse_interval(&mut self, pulse_interval_ticks: u128) {
        let Some(previous_interval_ticks) = self.pulse_interval_ticks else {
            self.pulse_interval_ticks = Some(pulse_interval_ticks);
            return;
        };
        if previous_interval_ticks == pulse_interval_ticks {
            return;
        }

        let scaled_remaining_ticks = self.ticks_until_next_pulse * pulse_interval_ticks;
        let rounding_ticks = previous_interval_ticks / 2;
        self.ticks_until_next_pulse =
            (scaled_remaining_ticks + rounding_ticks) / previous_interval_ticks;
        if self.ticks_until_next_pulse > pulse_interval_ticks {
            self.ticks_until_next_pulse = pulse_interval_ticks;
        }

        self.pulse_interval_ticks = Some(pulse_interval_ticks);
    }

    fn apply_transition(
        &mut self,
        transition: MidiClockTransportTransition,
        output: &mut MidiClockEventBuffer,
    ) {
        match transition {
            MidiClockTransportTransition::None => {}
            MidiClockTransportTransition::Start => {
                self.is_playing = true;
                self.ticks_until_next_pulse = 0;
                output.push(MidiClockEvent {
                    sample_offset: 0,
                    kind: MidiClockEventKind::Start,
                });
            }
            MidiClockTransportTransition::Continue => {
                self.is_playing = true;
                output.push(MidiClockEvent {
                    sample_offset: 0,
                    kind: MidiClockEventKind::Continue,
                });
            }
            MidiClockTransportTransition::Stop => {
                self.is_playing = false;
                output.push(MidiClockEvent {
                    sample_offset: 0,
                    kind: MidiClockEventKind::Stop,
                });
            }
            MidiClockTransportTransition::Seek => {
                self.ticks_until_next_pulse = 0;
                if self.is_playing {
                    output.push(MidiClockEvent {
                        sample_offset: 0,
                        kind: MidiClockEventKind::Continue,
                    });
                }
            }
        }
    }

    fn schedule_pulses(
        &mut self,
        block_sample_count: usize,
        pulse_interval_ticks: u128,
        output: &mut MidiClockEventBuffer,
    ) {
        let block_ticks = (block_sample_count as u128) << SUBSAMPLE_BITS;
        let mut pulse_offset_ticks = self.ticks_until_next_pulse;

        while pulse_offset_ticks < block_ticks && !output.is_full() {
            output.push(MidiClockEvent {
                sample_offset: (pulse_offset_ticks >> SUBSAMPLE_BITS) as usize,
                kind: MidiClockEventKind::TimingClock,
            });
            pulse_offset_ticks += pulse_interval_ticks;
        }

        if pulse_offset_ticks < block_ticks {
            let remaining_ticks = block_ticks - pulse_offset_ticks;
            let dropped_pulse_count =
                (remaining_ticks + pulse_interval_ticks - 1) / pulse_interval_ticks;
            let bounded_dropped_count = match u64::try_from(dropped_pulse_count) {
                Ok(count) => count,
                Err(_) => u64::MAX,
            };
            output.record_dropped_events(bounded_dropped_count);
            pulse_offset_ticks += dropped_pulse_count * pulse_interval_ticks;
        }

        self.ticks_until_next_pulse = pulse_offset_ticks - block_ticks;
    }
}

impl Default for MidiClock {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RATE: u32 = 48_000;
    const TEMPO_BPM: f64 = 120.0;
    const SAMPLES_PER_CLOCK: u64 = 1_000;

    fn input(
        timeline_sample: u64,
        block_sample_count: usize,
        tempo_bpm: f64,
        transition: MidiClockTransportTransition,
    ) -> MidiClockBlockInput {
        MidiClockBlockInput {
            timeline_sample,
            block_sample_count,
            sample_rate: SAMPLE_RATE,
            tempo_bpm,
            transition,
        }
    }

    fn process(
        clock: &mut MidiClock,
        timeline_sample: u64,
        block_sample_count: usize,
        tempo_bpm: f64,
        transition: MidiClockTransportTransition,
    ) -> MidiClockEventBuffer {
        clock
            .process_block(input(
                timeline_sample,
                block_sample_count,
                tempo_bpm,
                transition,
            ))
            .expect("valid clock block should process")
    }

    fn timing_clock_offsets(events: &MidiClockEventBuffer) -> Vec<usize> {
        events
            .iter()
            .filter(|event| event.kind == MidiClockEventKind::TimingClock)
            .map(|event| event.sample_offset)
            .collect()
    }

    fn collect_timing_clock_samples(
        tempo_bpm: f64,
        total_samples: u64,
        block_sizes: &[usize],
    ) -> Vec<u64> {
        let mut clock = MidiClock::new();
        let mut timeline_sample = 0u64;
        let mut block_index = 0usize;
        let mut pulse_samples = Vec::new();

        while timeline_sample < total_samples {
            let remaining = (total_samples - timeline_sample) as usize;
            let block_sample_count = block_sizes[block_index % block_sizes.len()].min(remaining);
            let transition = if timeline_sample == 0 {
                MidiClockTransportTransition::Start
            } else {
                MidiClockTransportTransition::None
            };
            let events = process(
                &mut clock,
                timeline_sample,
                block_sample_count,
                tempo_bpm,
                transition,
            );

            for event in events.iter() {
                if event.kind == MidiClockEventKind::TimingClock {
                    pulse_samples.push(timeline_sample + event.sample_offset as u64);
                }
            }

            timeline_sample += block_sample_count as u64;
            block_index += 1;
        }

        pulse_samples
    }

    #[test]
    fn start_continue_and_stop_use_explicit_sample_zero_transitions() {
        let mut clock = MidiClock::new();

        let start_events = process(
            &mut clock,
            0,
            500,
            TEMPO_BPM,
            MidiClockTransportTransition::Start,
        );
        assert_eq!(
            start_events.as_slice(),
            &[
                MidiClockEvent {
                    sample_offset: 0,
                    kind: MidiClockEventKind::Start,
                },
                MidiClockEvent {
                    sample_offset: 0,
                    kind: MidiClockEventKind::TimingClock,
                },
            ]
        );

        let stop_events = process(
            &mut clock,
            500,
            0,
            TEMPO_BPM,
            MidiClockTransportTransition::Stop,
        );
        assert_eq!(
            stop_events.as_slice(),
            &[MidiClockEvent {
                sample_offset: 0,
                kind: MidiClockEventKind::Stop,
            }]
        );
        assert!(!clock.is_playing());

        let stopped_events = process(
            &mut clock,
            500,
            2_000,
            TEMPO_BPM,
            MidiClockTransportTransition::None,
        );
        assert!(stopped_events.is_empty());

        let continue_events = process(
            &mut clock,
            2_500,
            501,
            TEMPO_BPM,
            MidiClockTransportTransition::Continue,
        );
        assert_eq!(
            continue_events.as_slice(),
            &[
                MidiClockEvent {
                    sample_offset: 0,
                    kind: MidiClockEventKind::Continue,
                },
                MidiClockEvent {
                    sample_offset: 500,
                    kind: MidiClockEventKind::TimingClock,
                },
            ]
        );
        assert!(clock.is_playing());
    }

    #[test]
    fn seek_rephases_the_clock_at_an_explicit_timeline_discontinuity() {
        let mut clock = MidiClock::new();
        let _ = process(
            &mut clock,
            0,
            250,
            TEMPO_BPM,
            MidiClockTransportTransition::Start,
        );

        let seek_events = process(
            &mut clock,
            96_000,
            1_001,
            TEMPO_BPM,
            MidiClockTransportTransition::Seek,
        );
        assert_eq!(
            seek_events.as_slice(),
            &[
                MidiClockEvent {
                    sample_offset: 0,
                    kind: MidiClockEventKind::Continue,
                },
                MidiClockEvent {
                    sample_offset: 0,
                    kind: MidiClockEventKind::TimingClock,
                },
                MidiClockEvent {
                    sample_offset: 1_000,
                    kind: MidiClockEventKind::TimingClock,
                },
            ]
        );
    }

    #[test]
    fn an_unannounced_playing_timeline_discontinuity_is_rejected() {
        let mut clock = MidiClock::new();
        let _ = process(
            &mut clock,
            0,
            128,
            TEMPO_BPM,
            MidiClockTransportTransition::Start,
        );

        let result = clock.process_block(input(
            1_024,
            128,
            TEMPO_BPM,
            MidiClockTransportTransition::None,
        ));

        assert_eq!(
            result,
            Err(MidiClockError::TimelineDiscontinuity {
                expected_sample: 128,
                received_sample: 1_024,
            })
        );
    }

    #[test]
    fn stop_and_continue_must_not_hide_timeline_discontinuities() {
        let mut clock = MidiClock::new();
        let _ = process(
            &mut clock,
            0,
            128,
            TEMPO_BPM,
            MidiClockTransportTransition::Start,
        );

        let stop_result = clock.process_block(input(
            1_024,
            0,
            TEMPO_BPM,
            MidiClockTransportTransition::Stop,
        ));
        assert_eq!(
            stop_result,
            Err(MidiClockError::TimelineDiscontinuity {
                expected_sample: 128,
                received_sample: 1_024,
            })
        );

        let _ = process(
            &mut clock,
            128,
            128,
            TEMPO_BPM,
            MidiClockTransportTransition::Stop,
        );
        let continue_result = clock.process_block(input(
            1_024,
            128,
            TEMPO_BPM,
            MidiClockTransportTransition::Continue,
        ));
        assert_eq!(
            continue_result,
            Err(MidiClockError::TimelineDiscontinuity {
                expected_sample: 256,
                received_sample: 1_024,
            })
        );
    }

    #[test]
    fn tempo_changes_preserve_fractional_pulse_phase() {
        let mut clock = MidiClock::new();
        let start_events = process(
            &mut clock,
            0,
            500,
            120.0,
            MidiClockTransportTransition::Start,
        );
        assert_eq!(timing_clock_offsets(&start_events), vec![0]);

        let faster_events = process(
            &mut clock,
            500,
            500,
            240.0,
            MidiClockTransportTransition::None,
        );
        assert_eq!(timing_clock_offsets(&faster_events), vec![250]);

        let slower_events = process(
            &mut clock,
            1_000,
            1_001,
            60.0,
            MidiClockTransportTransition::None,
        );
        assert_eq!(timing_clock_offsets(&slower_events), vec![1_000]);
    }

    #[test]
    fn variable_audio_blocks_keep_pulses_on_the_sample_timeline() {
        let block_sizes = [127usize, 511, 64, 257, 1_024, 17, 333];
        let total_samples = SAMPLE_RATE as u64;
        let mut clock = MidiClock::new();
        let mut timeline_sample = 0u64;
        let mut block_index = 0usize;
        let mut pulse_samples = Vec::new();

        while timeline_sample < total_samples {
            let remaining = (total_samples - timeline_sample) as usize;
            let block_sample_count = block_sizes[block_index % block_sizes.len()].min(remaining);
            let transition = if timeline_sample == 0 {
                MidiClockTransportTransition::Start
            } else {
                MidiClockTransportTransition::None
            };
            let events = process(
                &mut clock,
                timeline_sample,
                block_sample_count,
                TEMPO_BPM,
                transition,
            );

            for event in events.iter() {
                if event.kind == MidiClockEventKind::TimingClock {
                    pulse_samples.push(timeline_sample + event.sample_offset as u64);
                }
            }

            timeline_sample += block_sample_count as u64;
            block_index += 1;
        }

        let expected: Vec<u64> = (0..48).map(|index| index * SAMPLES_PER_CLOCK).collect();
        assert_eq!(pulse_samples, expected);
    }

    #[test]
    fn variable_blocks_do_not_move_integer_interval_pulses_early() {
        let pulse_samples =
            collect_timing_clock_samples(48.0, 5_001, &[127, 511, 64, 257, 1_024, 17, 333]);

        assert_eq!(pulse_samples, vec![0, 2_500, 5_000]);
    }

    #[test]
    fn non_integer_pulse_phase_is_invariant_to_block_partitioning() {
        let total_samples = SAMPLE_RATE as u64 * 2;
        let one_block =
            collect_timing_clock_samples(123.0, total_samples, &[total_samples as usize]);
        let variable_blocks = collect_timing_clock_samples(
            123.0,
            total_samples,
            &[127, 511, 64, 257, 1_024, 17, 333],
        );

        assert_eq!(variable_blocks, one_block);
    }

    #[test]
    fn sixty_second_end_exclusive_window_has_exact_pulse_count() {
        let total_samples = SAMPLE_RATE as u64 * 60;
        let pulse_samples =
            collect_timing_clock_samples(32.0, total_samples, &[127, 511, 64, 257, 1_024, 17, 333]);

        assert_eq!(pulse_samples.len(), 768);
        assert_eq!(pulse_samples.last(), Some(&2_876_250));
        assert!(pulse_samples.iter().all(|sample| *sample < total_samples));
    }

    #[test]
    fn sixty_second_clock_jitter_stays_below_half_a_millisecond() {
        let block_sizes = [127usize, 256, 511, 64, 1_000, 17, 333];
        let total_samples = SAMPLE_RATE as u64 * 60;
        let mut clock = MidiClock::new();
        let mut timeline_sample = 0u64;
        let mut block_index = 0usize;
        let mut pulse_samples = Vec::new();

        while timeline_sample < total_samples {
            let remaining = (total_samples - timeline_sample) as usize;
            let block_sample_count = block_sizes[block_index % block_sizes.len()].min(remaining);
            let transition = if timeline_sample == 0 {
                MidiClockTransportTransition::Start
            } else {
                MidiClockTransportTransition::None
            };
            let events = process(
                &mut clock,
                timeline_sample,
                block_sample_count,
                TEMPO_BPM,
                transition,
            );

            for event in events.iter() {
                if event.kind == MidiClockEventKind::TimingClock {
                    pulse_samples.push(timeline_sample + event.sample_offset as u64);
                }
            }

            timeline_sample += block_sample_count as u64;
            block_index += 1;
        }

        assert_eq!(pulse_samples.len(), 2_880);

        let squared_error_sum = pulse_samples
            .iter()
            .enumerate()
            .map(|(index, actual_sample)| {
                let expected_sample = index as f64 * SAMPLES_PER_CLOCK as f64;
                let error_samples = *actual_sample as f64 - expected_sample;
                error_samples * error_samples
            })
            .sum::<f64>();
        let standard_deviation_samples = (squared_error_sum / pulse_samples.len() as f64).sqrt();
        let standard_deviation_ms = standard_deviation_samples * 1_000.0 / SAMPLE_RATE as f64;

        assert!(
            standard_deviation_ms <= 0.5,
            "clock jitter was {standard_deviation_ms} ms"
        );
    }

    #[test]
    fn oversized_blocks_bound_output_and_advance_past_dropped_pulses() {
        let mut clock = MidiClock::new();
        let block_sample_count = SAMPLE_RATE as usize * 10;
        let events = process(
            &mut clock,
            0,
            block_sample_count,
            960.0,
            MidiClockTransportTransition::Start,
        );

        assert_eq!(events.len(), MIDI_CLOCK_EVENT_CAPACITY);
        assert!(events.dropped_event_count() > 0);

        let next_events = process(
            &mut clock,
            block_sample_count as u64,
            1,
            960.0,
            MidiClockTransportTransition::None,
        );
        assert_eq!(timing_clock_offsets(&next_events), vec![0]);
    }
}
