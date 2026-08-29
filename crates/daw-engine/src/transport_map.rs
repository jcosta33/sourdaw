//! The arrangement's tempo map, time-signature map and loop region, in the
//! form the audio thread can read.
//!
//! The engine's transport used to hold three flat scalars — one tempo, one
//! meter, no loop — so a session with a tempo change fed every tempo-driven
//! device (the arpeggiator's step clock, a hosted plugin's transport) a tempo
//! the arrangement stopped using, and a loop had to be closed by the control
//! thread relocating the playhead a block late. Both are timing defects, and
//! neither can be fixed on the control side: only the thread that owns the
//! playhead knows which frame it is on.
//!
//! ## Why the maps are precomputed
//!
//! A tempo map's musical coordinate — how many beats have elapsed at a frame —
//! is an integral over every earlier segment. Evaluating it from the segment
//! list would walk the whole map on every block. Instead each segment carries
//! the beat position its own start frame sits on, computed once on the control
//! thread when the map is built, so the audio thread resolves a frame with one
//! binary search and one multiply. No allocation, no iteration proportional to
//! the map.
//!
//! ## The ownership law this extends
//!
//! `GraphCommand::SetTransport` owns the flat tempo and meter, and
//! `GraphCommand::SetTransportPlayback` owns playback state and position
//! (`crates/sourdaw-native/src/commands/graph.rs`, the transport ownership
//! law). The maps are a third owner with a third producer: while a map is
//! installed it is authoritative for tempo, meter and beat position at the
//! playhead, and the flat scalars are the fallback the engine falls back to
//! when no map is installed. That keeps every existing caller — the offline
//! renderer above all — on exactly the behaviour it had.

/// Tempo segments one map may hold.
///
/// The map is a fixed-capacity value because the audio thread reads it: a map
/// the control thread could grow without bound is a map the callback can be
/// handed at any size. A tempo change per bar for a twenty-minute arrangement
/// at 120 BPM is 600 segments, so the ceiling is stated at four figures rather
/// than at the smallest number that happens to work today.
pub const MAX_TEMPO_SEGMENTS: usize = 4096;

/// Time-signature segments one map may hold, on the same contract.
pub const MAX_TIME_SIGNATURE_SEGMENTS: usize = 4096;

/// One constant-tempo span of the arrangement.
///
/// A segment is flat by construction. A ramped tempo change in project truth
/// is sampled into flat segments by its producer, because a ramp evaluated on
/// the audio thread would need a transcendental per block and would still have
/// to be integrated to answer the beat position.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TempoSegment {
    /// Absolute timeline frame this tempo takes effect on.
    pub start_frame: u64,
    pub beats_per_minute: f64,
}

/// One constant-meter span of the arrangement.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TimeSignatureSegment {
    pub start_frame: u64,
    pub numerator: u16,
    pub denominator: u16,
}

/// Why a map could not be built. Every one of these is a control-side
/// programming error rather than a user-reachable state, and every one of them
/// would make an audio-thread lookup answer nonsense, so the map refuses to
/// exist rather than being repaired silently.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TransportMapError {
    Empty,
    DoesNotStartAtZero,
    OutOfOrder,
    OverCapacity,
    NonPositiveTempo,
    NonPositiveTimeSignature,
}

impl std::fmt::Display for TransportMapError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let reason = match self {
            Self::Empty => "a transport map needs at least one segment",
            Self::DoesNotStartAtZero => "a transport map's first segment must start at frame 0",
            Self::OutOfOrder => "transport map segments must start on strictly increasing frames",
            Self::OverCapacity => "the transport map holds more segments than the engine accepts",
            Self::NonPositiveTempo => "a tempo segment must carry a finite, positive tempo",
            Self::NonPositiveTimeSignature => "a time-signature segment must carry positive parts",
        };
        formatter.write_str(reason)
    }
}

/// The index of the last segment starting at or before `frame`.
///
/// `start_frames` is sorted and its first element is zero, so the partition
/// point is at least one and the subtraction never wraps. Binary search rather
/// than a remembered cursor: a locate and a loop wrap both move the playhead
/// backwards, and a cursor that walks back is unbounded in exactly the case a
/// bound matters most.
fn segment_index(start_frames: &[u64], frame: u64) -> usize {
    start_frames
        .partition_point(|start| *start <= frame)
        .saturating_sub(1)
}

/// The arrangement's tempo, as a function of the timeline frame.
#[derive(Clone, Debug, PartialEq)]
pub struct TempoMap {
    start_frames: Vec<u64>,
    beats_per_minute: Vec<f64>,
    /// Beats elapsed at each segment's own start frame, integrated once on the
    /// control thread. This is what keeps the audio-thread lookup O(log n)
    /// instead of O(n).
    start_beats: Vec<f64>,
}

impl TempoMap {
    /// Build a map from segments already in timeline order.
    ///
    /// `sample_rate` is baked in because the beat integral is a function of it
    /// and the audio thread must not be handed a map it has to re-integrate.
    /// A map built for one rate is wrong at another, which is why the engine
    /// rebuilds its maps when the device rate changes rather than converting
    /// them.
    pub fn new(segments: &[TempoSegment], sample_rate: f64) -> Result<Self, TransportMapError> {
        if segments.is_empty() {
            return Err(TransportMapError::Empty);
        }
        if segments.len() > MAX_TEMPO_SEGMENTS {
            return Err(TransportMapError::OverCapacity);
        }
        if segments[0].start_frame != 0 {
            return Err(TransportMapError::DoesNotStartAtZero);
        }
        if !sample_rate.is_finite() || sample_rate <= 0.0 {
            return Err(TransportMapError::NonPositiveTempo);
        }

        let mut start_frames = Vec::with_capacity(segments.len());
        let mut beats_per_minute = Vec::with_capacity(segments.len());
        let mut start_beats = Vec::with_capacity(segments.len());
        let mut elapsed_beats = 0.0f64;

        for (index, segment) in segments.iter().enumerate() {
            if !segment.beats_per_minute.is_finite() || segment.beats_per_minute <= 0.0 {
                return Err(TransportMapError::NonPositiveTempo);
            }
            if index > 0 {
                let previous = segments[index - 1];
                if segment.start_frame <= previous.start_frame {
                    return Err(TransportMapError::OutOfOrder);
                }
                let span_frames = (segment.start_frame - previous.start_frame) as f64;
                elapsed_beats += span_frames / sample_rate * previous.beats_per_minute / 60.0;
            }
            start_frames.push(segment.start_frame);
            beats_per_minute.push(segment.beats_per_minute);
            start_beats.push(elapsed_beats);
        }

        Ok(Self {
            start_frames,
            beats_per_minute,
            start_beats,
        })
    }

    /// The one-segment map a flat tempo describes — the shape the engine holds
    /// before any producer installs an arrangement's map.
    pub fn flat(beats_per_minute: f64, sample_rate: f64) -> Result<Self, TransportMapError> {
        Self::new(
            &[TempoSegment {
                start_frame: 0,
                beats_per_minute,
            }],
            sample_rate,
        )
    }

    pub fn segment_count(&self) -> usize {
        self.start_frames.len()
    }

    /// The tempo in force at `frame`.
    pub fn tempo_at(&self, frame: u64) -> f64 {
        self.beats_per_minute[segment_index(&self.start_frames, frame)]
    }

    /// Beats elapsed from frame 0 to `frame`, integrated across every segment
    /// the frame sits past.
    pub fn beats_at(&self, frame: u64, sample_rate: f64) -> f64 {
        let index = segment_index(&self.start_frames, frame);
        let span_frames = (frame - self.start_frames[index]) as f64;
        self.start_beats[index] + span_frames / sample_rate * self.beats_per_minute[index] / 60.0
    }
}

/// The arrangement's meter, as a function of the timeline frame.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimeSignatureMap {
    start_frames: Vec<u64>,
    numerators: Vec<u16>,
    denominators: Vec<u16>,
}

impl TimeSignatureMap {
    pub fn new(segments: &[TimeSignatureSegment]) -> Result<Self, TransportMapError> {
        if segments.is_empty() {
            return Err(TransportMapError::Empty);
        }
        if segments.len() > MAX_TIME_SIGNATURE_SEGMENTS {
            return Err(TransportMapError::OverCapacity);
        }
        if segments[0].start_frame != 0 {
            return Err(TransportMapError::DoesNotStartAtZero);
        }

        let mut start_frames = Vec::with_capacity(segments.len());
        let mut numerators = Vec::with_capacity(segments.len());
        let mut denominators = Vec::with_capacity(segments.len());

        for (index, segment) in segments.iter().enumerate() {
            if segment.numerator == 0 || segment.denominator == 0 {
                return Err(TransportMapError::NonPositiveTimeSignature);
            }
            if index > 0 && segment.start_frame <= segments[index - 1].start_frame {
                return Err(TransportMapError::OutOfOrder);
            }
            start_frames.push(segment.start_frame);
            numerators.push(segment.numerator);
            denominators.push(segment.denominator);
        }

        Ok(Self {
            start_frames,
            numerators,
            denominators,
        })
    }

    pub fn flat(numerator: u16, denominator: u16) -> Result<Self, TransportMapError> {
        Self::new(&[TimeSignatureSegment {
            start_frame: 0,
            numerator,
            denominator,
        }])
    }

    pub fn segment_count(&self) -> usize {
        self.start_frames.len()
    }

    /// The meter in force at `frame`, as `(numerator, denominator)`.
    pub fn at(&self, frame: u64) -> (u16, u16) {
        let index = segment_index(&self.start_frames, frame);
        (self.numerators[index], self.denominators[index])
    }
}

/// Both maps, published together.
///
/// They travel as one value because they describe one arrangement at one
/// revision: installed separately, a block between the two commands would
/// render a tempo from the new arrangement against a meter from the old one.
#[derive(Clone, Debug, PartialEq)]
pub struct TransportMaps {
    pub tempo: TempoMap,
    pub time_signature: TimeSignatureMap,
    /// The rate `tempo`'s beat integral was built against. The engine refuses
    /// a map built for another rate rather than reading it at the wrong one.
    pub sample_rate: f64,
}

/// The engine's smallest honoured loop region, in frames.
///
/// The seam is rendered by splitting a callback at the loop end, so the wraps
/// one callback can hold are `callback_frames / loop_length`. A floor on the
/// loop length is what turns that into a constant, and a constant is what lets
/// the split be a fixed-size stack walk instead of an unbounded loop on the
/// audio thread. At 48 kHz this floor is under 11 ms — an order of magnitude
/// shorter than the fastest loop a musician can set on a bar grid, so nothing
/// musical is refused by it.
pub const MIN_LOOP_FRAMES: u64 = 512;

/// The transport's loop region.
///
/// `enabled` is held separately from the bounds so toggling the loop off and
/// on again returns to the region the user set, which is what every DAW's loop
/// toggle does.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct LoopRegion {
    pub enabled: bool,
    pub start_frame: u64,
    pub end_frame: u64,
}

impl LoopRegion {
    /// The region's end, or `None` when nothing should wrap.
    ///
    /// A region shorter than [`MIN_LOOP_FRAMES`] is held but not honoured: see
    /// that constant for why the floor exists. This is the single place the
    /// audio thread asks whether it is looping, so no caller can honour a
    /// region this one refuses.
    pub const fn active_end(&self) -> Option<u64> {
        if !self.enabled {
            return None;
        }
        if self.end_frame < self.start_frame.saturating_add(MIN_LOOP_FRAMES) {
            return None;
        }
        Some(self.end_frame)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 48_000.0;

    #[test]
    fn a_flat_map_reports_its_tempo_everywhere_and_counts_beats_linearly() {
        let map = TempoMap::flat(120.0, RATE).expect("a flat map is well formed");

        assert_eq!(map.segment_count(), 1);
        assert_eq!(map.tempo_at(0), 120.0);
        assert_eq!(map.tempo_at(10_000_000), 120.0);
        // 120 BPM is two beats a second.
        assert!((map.beats_at(48_000, RATE) - 2.0).abs() < 1e-9);
    }

    #[test]
    fn beats_integrate_across_a_tempo_change_rather_than_scaling_the_last_tempo() {
        // 120 BPM for one second (2 beats), then 240 BPM for one second (4).
        let map = TempoMap::new(
            &[
                TempoSegment {
                    start_frame: 0,
                    beats_per_minute: 120.0,
                },
                TempoSegment {
                    start_frame: 48_000,
                    beats_per_minute: 240.0,
                },
            ],
            RATE,
        )
        .expect("an ordered map is well formed");

        assert_eq!(map.tempo_at(47_999), 120.0);
        assert_eq!(map.tempo_at(48_000), 240.0);
        assert!((map.beats_at(48_000, RATE) - 2.0).abs() < 1e-9);
        assert!((map.beats_at(96_000, RATE) - 6.0).abs() < 1e-9);
        // The flat-scalar answer this replaces would be 96_000 / 48_000 * 240 /
        // 60 = 8 beats: proof the integral is not just the last tempo scaled.
        assert!((map.beats_at(96_000, RATE) - 8.0).abs() > 1.0);
    }

    #[test]
    fn a_map_that_is_empty_unordered_or_late_starting_refuses() {
        assert_eq!(TempoMap::new(&[], RATE), Err(TransportMapError::Empty));
        assert_eq!(
            TempoMap::new(
                &[TempoSegment {
                    start_frame: 1,
                    beats_per_minute: 120.0
                }],
                RATE
            ),
            Err(TransportMapError::DoesNotStartAtZero)
        );
        assert_eq!(
            TempoMap::new(
                &[
                    TempoSegment {
                        start_frame: 0,
                        beats_per_minute: 120.0
                    },
                    TempoSegment {
                        start_frame: 0,
                        beats_per_minute: 90.0
                    },
                ],
                RATE
            ),
            Err(TransportMapError::OutOfOrder)
        );
        assert_eq!(
            TempoMap::new(
                &[TempoSegment {
                    start_frame: 0,
                    beats_per_minute: 0.0
                }],
                RATE
            ),
            Err(TransportMapError::NonPositiveTempo)
        );
    }

    #[test]
    fn the_meter_map_answers_the_segment_in_force_at_a_frame() {
        let map = TimeSignatureMap::new(&[
            TimeSignatureSegment {
                start_frame: 0,
                numerator: 4,
                denominator: 4,
            },
            TimeSignatureSegment {
                start_frame: 96_000,
                numerator: 7,
                denominator: 8,
            },
        ])
        .expect("an ordered meter map is well formed");

        assert_eq!(map.at(0), (4, 4));
        assert_eq!(map.at(95_999), (4, 4));
        assert_eq!(map.at(96_000), (7, 8));
        assert_eq!(
            TimeSignatureMap::new(&[TimeSignatureSegment {
                start_frame: 0,
                numerator: 0,
                denominator: 4,
            }]),
            Err(TransportMapError::NonPositiveTimeSignature)
        );
    }

    #[test]
    fn a_loop_region_shorter_than_one_callback_is_held_but_not_honoured() {
        let honoured = LoopRegion {
            enabled: true,
            start_frame: 1_000,
            end_frame: 1_000 + MIN_LOOP_FRAMES,
        };
        assert_eq!(honoured.active_end(), Some(1_000 + MIN_LOOP_FRAMES));

        let too_short = LoopRegion {
            enabled: true,
            start_frame: 1_000,
            end_frame: 1_000 + MIN_LOOP_FRAMES - 1,
        };
        assert_eq!(too_short.active_end(), None);

        let disabled = LoopRegion {
            enabled: false,
            ..honoured
        };
        assert_eq!(disabled.active_end(), None);
    }
}
