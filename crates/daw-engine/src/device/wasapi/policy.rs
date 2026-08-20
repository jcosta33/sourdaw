//! Pure Windows device-negotiation policy — no Windows API imports.
//!
//! Everything here is arithmetic and decision logic: which shared engine
//! period to ask IAudioClient3 for, in which order formats are offered,
//! how a WASAPI `HRESULT` maps onto the engine's fixed stream-error
//! vocabulary, and when a refused Exclusive claim degrades to the shared
//! path versus failing outright. The COM plumbing behind these decisions
//! lives in `backend.rs` and implements [`DeviceNegotiation`]; hosts
//! without a Windows SDK exercise this module directly under `cfg(test)`
//! with a scripted fake, which is why nothing in this file may name a
//! `windows`-crate type.

use crate::engine_events::StreamErrorKind;

// AUDCLNT_E_* facility codes, from `audioclient.h`:
// `AUDCLNT_ERR(n)` is `MAKE_HRESULT(SEVERITY_ERROR, FACILITY_AUDCLNT, n)`
// with `FACILITY_AUDCLNT = 0x889`, i.e. `0x8889_0000 | n`. Mirrored as
// plain `i32` values so the taxonomy is testable on every host; the
// Windows backend feeds `HRESULT.0` straight in.
pub(crate) const AUDCLNT_E_DEVICE_INVALIDATED: i32 = 0x8889_0004_u32 as i32;
pub(crate) const AUDCLNT_E_UNSUPPORTED_FORMAT: i32 = 0x8889_0008_u32 as i32;
pub(crate) const AUDCLNT_E_DEVICE_IN_USE: i32 = 0x8889_000A_u32 as i32;
pub(crate) const AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED: i32 = 0x8889_000E_u32 as i32;
pub(crate) const AUDCLNT_E_SERVICE_NOT_RUNNING: i32 = 0x8889_0010_u32 as i32;
pub(crate) const AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED: i32 = 0x8889_0019_u32 as i32;

/// Map a WASAPI `HRESULT` family onto the engine's fixed stream-error
/// vocabulary ([`StreamErrorKind`], the same enum the cpal path publishes
/// through the engine event ring).
///
/// - device invalidated → the device went away
///   ([`StreamErrorKind::DeviceNotAvailable`]);
/// - busy / in use / exclusive claim held elsewhere → another client owns
///   the endpoint ([`StreamErrorKind::DeviceBusy`]);
/// - format unsupported → the stream configuration must be rebuilt
///   ([`StreamErrorKind::StreamInvalidated`]);
/// - audio service not running → nothing on the machine can produce
///   sound, indistinguishable in consequence from a device that is gone
///   ([`StreamErrorKind::DeviceNotAvailable`]);
/// - anything else → [`StreamErrorKind::BackendSpecific`], reported
///   rather than silently discarded.
pub(crate) fn stream_error_kind_for_hresult(hresult: i32) -> StreamErrorKind {
    match hresult {
        AUDCLNT_E_DEVICE_INVALIDATED => StreamErrorKind::DeviceNotAvailable,
        AUDCLNT_E_DEVICE_IN_USE | AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED => {
            StreamErrorKind::DeviceBusy
        }
        AUDCLNT_E_UNSUPPORTED_FORMAT => StreamErrorKind::StreamInvalidated,
        AUDCLNT_E_SERVICE_NOT_RUNNING => StreamErrorKind::DeviceNotAvailable,
        _ => StreamErrorKind::BackendSpecific,
    }
}

/// An `HRESULT` after which no further negotiation on this endpoint can
/// succeed: the device is gone or the audio service is down, so retrying
/// with another format or mode would only re-observe the same condition.
pub(crate) fn is_fatal_negotiation_hresult(hresult: i32) -> bool {
    matches!(
        hresult,
        AUDCLNT_E_DEVICE_INVALIDATED | AUDCLNT_E_SERVICE_NOT_RUNNING
    )
}

/// What `IAudioClient3::GetSharedModeEnginePeriod` reported, in frames at
/// the queried format's rate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SharedEnginePeriods {
    pub default: u32,
    pub fundamental: u32,
    pub min: u32,
    pub max: u32,
}

/// The period to ask `InitializeSharedAudioStream` for: the smallest the
/// driver supports, aligned up to a multiple of the fundamental period.
///
/// The driver contract says `min` is itself a supported period, but a
/// misaligned or zeroed report from a defective driver must not turn into
/// a request the API rejects: the minimum is rounded up to the nearest
/// fundamental multiple, and a report whose alignment lands past `max`
/// falls back to the driver's own default period rather than asking for
/// something the range says is impossible.
pub(crate) fn smallest_shared_period(periods: &SharedEnginePeriods) -> u32 {
    let fundamental = periods.fundamental.max(1);
    let minimum = periods.min.max(1);
    let aligned = minimum.div_ceil(fundamental) * fundamental;
    if periods.max != 0 && aligned > periods.max {
        return periods.default;
    }
    aligned
}

/// The sample layouts the engine's render callback can fill without a
/// resampler: its native f32, and i16 by quantization.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SampleLayout {
    F32,
    I16,
}

/// A concrete format offer: layout at a rate and channel count. The rate
/// is always the device's own mix rate — the shared engine cannot be
/// asked to run at another one, and offering it would add a resampler the
/// engine does not have.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FormatSpec {
    pub layout: SampleLayout,
    pub rate: u32,
    pub channels: u16,
}

/// Where a candidate came from, which is also its rung on the ladder.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum CandidateSource {
    /// The device's own mix format — the zero-conversion path.
    DeviceMix,
    /// The engine's native f32 at the device rate.
    EngineF32,
    /// i16 at the device rate — the layout every endpoint accepts.
    EngineI16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FormatCandidate {
    pub source: CandidateSource,
    pub spec: FormatSpec,
}

/// What `GetMixFormat` reported, reduced to what the ladder needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MixFormatReport {
    pub rate: u32,
    pub channels: u16,
    /// `None` when the mix layout is one the engine cannot fill (for
    /// example 24-bit-in-32 PCM); the mix rung is then skipped and the
    /// skip recorded as a refusal.
    pub renderable: Option<SampleLayout>,
}

/// The deterministic format ladder: device mix format first, then f32 at
/// the device rate, then i16 at the device rate. A later rung identical
/// to an earlier one is dropped rather than probed twice, so each refusal
/// in the record names a distinct offer.
pub(crate) fn format_ladder(mix: &MixFormatReport) -> Vec<FormatCandidate> {
    let mut candidates: Vec<FormatCandidate> = Vec::with_capacity(3);
    if let Some(layout) = mix.renderable {
        candidates.push(FormatCandidate {
            source: CandidateSource::DeviceMix,
            spec: FormatSpec {
                layout,
                rate: mix.rate,
                channels: mix.channels,
            },
        });
    }
    for (source, layout) in [
        (CandidateSource::EngineF32, SampleLayout::F32),
        (CandidateSource::EngineI16, SampleLayout::I16),
    ] {
        let spec = FormatSpec {
            layout,
            rate: mix.rate,
            channels: mix.channels,
        };
        if candidates.iter().all(|candidate| candidate.spec != spec) {
            candidates.push(FormatCandidate { source, spec });
        }
    }
    candidates
}

/// Which negotiation step refused, so the record reads as a path through
/// the ladder rather than a bag of HRESULTs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NegotiationStage {
    /// The mix format uses a layout the engine cannot fill; the rung was
    /// skipped without a device round trip (`hresult` is 0).
    MixLayoutUnrenderable,
    /// The Exclusive-mode claim on this format was refused.
    ExclusiveClaim,
    /// `GetSharedModeEnginePeriod` failed — IAudioClient3 missing or the
    /// format refused period negotiation.
    PeriodNegotiation,
    /// `InitializeSharedAudioStream` at the negotiated period failed.
    LowLatencyInitialize,
    /// Plain shared `IAudioClient::Initialize` failed.
    SharedInitialize,
}

/// One recorded refusal: which offer, at which step, with which code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FormatRefusal {
    pub source: CandidateSource,
    pub stage: NegotiationStage,
    pub hresult: i32,
}

/// The path a successful negotiation ended on — the fact the diagnostics
/// line reports, per ADR 0027's requirement that the engine says which
/// mode it is actually running in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowsStreamPath {
    /// WASAPI Exclusive — the endpoint is claimed by this stream alone.
    Exclusive,
    /// IAudioClient3 shared mode at a negotiated small engine period.
    SharedLowLatency { period_frames: u32 },
    /// Plain shared `Initialize` at the engine's default period — the
    /// fallback when IAudioClient3 is unsupported or the negotiated
    /// period was refused, and the whole path when the caller forced the
    /// default period.
    SharedDefaultPeriod,
}

/// A completed negotiation: the mode and format the stream initialized
/// with, plus everything that was refused on the way there.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct NegotiatedPlan {
    pub path: WindowsStreamPath,
    pub format: FormatCandidate,
    pub refusals: Vec<FormatRefusal>,
    /// `Some(hresult)` when Exclusive was requested and every claim was
    /// refused: the stream degraded to the shared path, observably —
    /// the caller must report it — and carries the last refusal's code.
    pub exclusive_degraded: Option<i32>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum NegotiationFailure {
    /// The endpoint cannot be negotiated with at all (device gone,
    /// service down); retrying other formats or modes is pointless.
    Fatal { hresult: i32 },
    /// Every rung of the ladder was refused; the record says why.
    Exhausted { refusals: Vec<FormatRefusal> },
}

/// What one refused Exclusive claim means for the open as a whole.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExclusiveClaimOutcome {
    UseExclusive,
    /// The claim was refused for a reason confined to Exclusive mode —
    /// device busy, format not endpoint-native — so the same device is
    /// still perfectly usable shared. ADR 0027: a refused claim degrades
    /// to the shared default, never silently and never fatally.
    DegradeToShared {
        hresult: i32,
    },
    /// The refusal says the endpoint itself is gone; shared would fail
    /// the same way.
    Fail {
        hresult: i32,
    },
}

pub(crate) fn exclusive_claim_outcome(claim: Result<(), i32>) -> ExclusiveClaimOutcome {
    match claim {
        Ok(()) => ExclusiveClaimOutcome::UseExclusive,
        Err(hresult) if is_fatal_negotiation_hresult(hresult) => {
            ExclusiveClaimOutcome::Fail { hresult }
        }
        Err(hresult) => ExclusiveClaimOutcome::DegradeToShared { hresult },
    }
}

/// The narrow seam over the Windows API. The live implementation holds
/// COM interfaces and turns each call into the corresponding WASAPI
/// method; the test implementation is a script. Nothing beyond this
/// trait is mocked — the policy is tested against the seam it actually
/// drives.
pub(crate) trait DeviceNegotiation {
    fn mix_format(&mut self) -> Result<MixFormatReport, i32>;
    fn shared_engine_periods(
        &mut self,
        candidate: &FormatCandidate,
    ) -> Result<SharedEnginePeriods, i32>;
    fn init_shared_low_latency(
        &mut self,
        candidate: &FormatCandidate,
        period_frames: u32,
    ) -> Result<(), i32>;
    fn init_shared_default(&mut self, candidate: &FormatCandidate) -> Result<(), i32>;
    fn init_exclusive(&mut self, candidate: &FormatCandidate) -> Result<(), i32>;
}

/// Drive one whole negotiation: the Exclusive opt-in first when asked
/// for, then the shared ladder — IAudioClient3 low-latency period where
/// the interface and the driver allow it, plain shared `Initialize`
/// otherwise. Deterministic order, first success wins, every refusal
/// recorded.
pub(crate) fn negotiate_windows_stream(
    session: &mut impl DeviceNegotiation,
    exclusive: bool,
    force_default_period: bool,
) -> Result<NegotiatedPlan, NegotiationFailure> {
    let mix = session
        .mix_format()
        .map_err(|hresult| NegotiationFailure::Fatal { hresult })?;

    let mut refusals: Vec<FormatRefusal> = Vec::new();
    if mix.renderable.is_none() {
        refusals.push(FormatRefusal {
            source: CandidateSource::DeviceMix,
            stage: NegotiationStage::MixLayoutUnrenderable,
            hresult: 0,
        });
    }
    let candidates = format_ladder(&mix);

    let mut exclusive_degraded = None;
    if exclusive {
        for candidate in &candidates {
            match exclusive_claim_outcome(session.init_exclusive(candidate)) {
                ExclusiveClaimOutcome::UseExclusive => {
                    return Ok(NegotiatedPlan {
                        path: WindowsStreamPath::Exclusive,
                        format: *candidate,
                        refusals,
                        exclusive_degraded: None,
                    });
                }
                ExclusiveClaimOutcome::Fail { hresult } => {
                    return Err(NegotiationFailure::Fatal { hresult });
                }
                ExclusiveClaimOutcome::DegradeToShared { hresult } => {
                    refusals.push(FormatRefusal {
                        source: candidate.source,
                        stage: NegotiationStage::ExclusiveClaim,
                        hresult,
                    });
                    exclusive_degraded = Some(hresult);
                }
            }
        }
    }

    for candidate in &candidates {
        if force_default_period {
            match try_shared_default(session, candidate, &mut refusals)? {
                true => {
                    return Ok(NegotiatedPlan {
                        path: WindowsStreamPath::SharedDefaultPeriod,
                        format: *candidate,
                        refusals,
                        exclusive_degraded,
                    });
                }
                false => continue,
            }
        }

        match session.shared_engine_periods(candidate) {
            Ok(periods) => {
                let period_frames = smallest_shared_period(&periods);
                match session.init_shared_low_latency(candidate, period_frames) {
                    Ok(()) => {
                        return Ok(NegotiatedPlan {
                            path: WindowsStreamPath::SharedLowLatency { period_frames },
                            format: *candidate,
                            refusals,
                            exclusive_degraded,
                        });
                    }
                    Err(hresult) if is_fatal_negotiation_hresult(hresult) => {
                        return Err(NegotiationFailure::Fatal { hresult });
                    }
                    Err(hresult) => {
                        refusals.push(FormatRefusal {
                            source: candidate.source,
                            stage: NegotiationStage::LowLatencyInitialize,
                            hresult,
                        });
                    }
                }
            }
            Err(hresult) if is_fatal_negotiation_hresult(hresult) => {
                return Err(NegotiationFailure::Fatal { hresult });
            }
            Err(hresult) => {
                // IAudioClient3 missing (E_NOINTERFACE) or the driver
                // refused to negotiate a period for this format: the
                // fallback ADR 0027 names — plain shared Initialize.
                refusals.push(FormatRefusal {
                    source: candidate.source,
                    stage: NegotiationStage::PeriodNegotiation,
                    hresult,
                });
            }
        }

        if try_shared_default(session, candidate, &mut refusals)? {
            return Ok(NegotiatedPlan {
                path: WindowsStreamPath::SharedDefaultPeriod,
                format: *candidate,
                refusals,
                exclusive_degraded,
            });
        }
    }

    Err(NegotiationFailure::Exhausted { refusals })
}

/// One plain shared `Initialize` attempt: `Ok(true)` on success,
/// `Ok(false)` with the refusal recorded when the ladder should move on,
/// `Err` when the endpoint is beyond negotiating with.
fn try_shared_default(
    session: &mut impl DeviceNegotiation,
    candidate: &FormatCandidate,
    refusals: &mut Vec<FormatRefusal>,
) -> Result<bool, NegotiationFailure> {
    match session.init_shared_default(candidate) {
        Ok(()) => Ok(true),
        Err(hresult) if is_fatal_negotiation_hresult(hresult) => {
            Err(NegotiationFailure::Fatal { hresult })
        }
        Err(hresult) => {
            refusals.push(FormatRefusal {
                source: candidate.source,
                stage: NegotiationStage::SharedInitialize,
                hresult,
            });
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        exclusive_claim_outcome, format_ladder, negotiate_windows_stream, smallest_shared_period,
        stream_error_kind_for_hresult, CandidateSource, DeviceNegotiation, ExclusiveClaimOutcome,
        FormatCandidate, FormatRefusal, FormatSpec, MixFormatReport, NegotiationFailure,
        NegotiationStage, SampleLayout, SharedEnginePeriods, WindowsStreamPath,
        AUDCLNT_E_DEVICE_INVALIDATED, AUDCLNT_E_DEVICE_IN_USE,
        AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED, AUDCLNT_E_SERVICE_NOT_RUNNING,
        AUDCLNT_E_UNSUPPORTED_FORMAT,
    };
    use crate::engine_events::StreamErrorKind;
    use std::collections::HashMap;

    /// `E_NOINTERFACE` — what `QueryInterface` for `IAudioClient3` returns
    /// on a system that only offers the plain `IAudioClient`.
    const E_NOINTERFACE: i32 = 0x8000_4002_u32 as i32;

    const MIX_F32_STEREO_48K: MixFormatReport = MixFormatReport {
        rate: 48_000,
        channels: 2,
        renderable: Some(SampleLayout::F32),
    };

    /// A scripted device: each `(source, stage)` step answers from its
    /// script, and every call is logged in order.
    struct FakeSession {
        mix: Result<MixFormatReport, i32>,
        periods: HashMap<CandidateSource, Result<SharedEnginePeriods, i32>>,
        low_latency: HashMap<CandidateSource, Result<(), i32>>,
        shared_default: HashMap<CandidateSource, Result<(), i32>>,
        exclusive: HashMap<CandidateSource, Result<(), i32>>,
        calls: Vec<String>,
    }

    impl FakeSession {
        fn new(mix: MixFormatReport) -> Self {
            Self {
                mix: Ok(mix),
                periods: HashMap::new(),
                low_latency: HashMap::new(),
                shared_default: HashMap::new(),
                exclusive: HashMap::new(),
                calls: Vec::new(),
            }
        }
    }

    const HEALTHY_PERIODS: SharedEnginePeriods = SharedEnginePeriods {
        default: 480,
        fundamental: 8,
        min: 128,
        max: 480,
    };

    impl DeviceNegotiation for FakeSession {
        fn mix_format(&mut self) -> Result<MixFormatReport, i32> {
            self.calls.push("mix_format".to_string());
            self.mix
        }

        fn shared_engine_periods(
            &mut self,
            candidate: &FormatCandidate,
        ) -> Result<SharedEnginePeriods, i32> {
            self.calls.push(format!("periods {:?}", candidate.source));
            *self
                .periods
                .get(&candidate.source)
                .unwrap_or(&Ok(HEALTHY_PERIODS))
        }

        fn init_shared_low_latency(
            &mut self,
            candidate: &FormatCandidate,
            period_frames: u32,
        ) -> Result<(), i32> {
            self.calls.push(format!(
                "low_latency {:?} {period_frames}",
                candidate.source
            ));
            *self.low_latency.get(&candidate.source).unwrap_or(&Ok(()))
        }

        fn init_shared_default(&mut self, candidate: &FormatCandidate) -> Result<(), i32> {
            self.calls
                .push(format!("shared_default {:?}", candidate.source));
            *self
                .shared_default
                .get(&candidate.source)
                .unwrap_or(&Ok(()))
        }

        fn init_exclusive(&mut self, candidate: &FormatCandidate) -> Result<(), i32> {
            self.calls.push(format!("exclusive {:?}", candidate.source));
            *self.exclusive.get(&candidate.source).unwrap_or(&Ok(()))
        }
    }

    // ---- period selection ----------------------------------------------

    #[test]
    fn the_smallest_supported_period_is_chosen_when_already_aligned() {
        assert_eq!(
            smallest_shared_period(&SharedEnginePeriods {
                default: 480,
                fundamental: 8,
                min: 128,
                max: 480,
            }),
            128
        );
    }

    #[test]
    fn a_misaligned_minimum_is_rounded_up_to_the_next_fundamental_multiple() {
        // min 130 with fundamental 8: 130/8 rounds up to 17 → 136 frames.
        assert_eq!(
            smallest_shared_period(&SharedEnginePeriods {
                default: 480,
                fundamental: 8,
                min: 130,
                max: 480,
            }),
            136
        );
    }

    #[test]
    fn a_zero_fundamental_report_does_not_divide_by_zero_and_keeps_the_minimum() {
        assert_eq!(
            smallest_shared_period(&SharedEnginePeriods {
                default: 480,
                fundamental: 0,
                min: 144,
                max: 480,
            }),
            144
        );
    }

    #[test]
    fn an_alignment_that_lands_past_the_maximum_falls_back_to_the_default_period() {
        // min 470 aligned to fundamental 32 is 480... make it land past max:
        // min 470, fundamental 64 → 512 > max 480 → the driver default.
        assert_eq!(
            smallest_shared_period(&SharedEnginePeriods {
                default: 448,
                fundamental: 64,
                min: 470,
                max: 480,
            }),
            448
        );
    }

    #[test]
    fn a_zeroed_minimum_is_lifted_to_one_fundamental_period_rather_than_zero_frames() {
        assert_eq!(
            smallest_shared_period(&SharedEnginePeriods {
                default: 480,
                fundamental: 8,
                min: 0,
                max: 480,
            }),
            8
        );
    }

    // ---- ladder shape ----------------------------------------------------

    #[test]
    fn the_ladder_offers_mix_then_f32_then_i16_without_duplicating_the_mix_rung() {
        // A float mix format IS the f32 rung; probing it twice would record
        // the same refusal under two names.
        let candidates = format_ladder(&MIX_F32_STEREO_48K);

        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.source)
                .collect::<Vec<_>>(),
            vec![CandidateSource::DeviceMix, CandidateSource::EngineI16]
        );
        assert_eq!(candidates[0].spec.layout, SampleLayout::F32);
        assert_eq!(candidates[1].spec.layout, SampleLayout::I16);
    }

    #[test]
    fn an_unrenderable_mix_format_leaves_the_engine_rungs_at_the_device_rate() {
        let candidates = format_ladder(&MixFormatReport {
            rate: 44_100,
            channels: 6,
            renderable: None,
        });

        assert_eq!(
            candidates,
            vec![
                FormatCandidate {
                    source: CandidateSource::EngineF32,
                    spec: FormatSpec {
                        layout: SampleLayout::F32,
                        rate: 44_100,
                        channels: 6,
                    },
                },
                FormatCandidate {
                    source: CandidateSource::EngineI16,
                    spec: FormatSpec {
                        layout: SampleLayout::I16,
                        rate: 44_100,
                        channels: 6,
                    },
                },
            ]
        );
    }

    // ---- shared negotiation ----------------------------------------------

    #[test]
    fn a_healthy_device_negotiates_the_smallest_engine_period_on_its_mix_format() {
        let mut session = FakeSession::new(MIX_F32_STEREO_48K);

        let plan = negotiate_windows_stream(&mut session, false, false).expect("a stream");

        assert_eq!(
            plan.path,
            WindowsStreamPath::SharedLowLatency { period_frames: 128 }
        );
        assert_eq!(plan.format.source, CandidateSource::DeviceMix);
        assert!(plan.refusals.is_empty());
        assert_eq!(plan.exclusive_degraded, None);
        // First success stops the ladder: the i16 rung is never probed.
        assert!(!session.calls.iter().any(|call| call.contains("EngineI16")));
    }

    #[test]
    fn negotiation_stops_at_the_first_accepted_format_and_records_each_refusal() {
        // A mix format the shared engine refuses at both period shapes: the
        // ladder moves to the next rung carrying both refusals with it.
        let mut session = FakeSession::new(MixFormatReport {
            rate: 48_000,
            channels: 2,
            renderable: Some(SampleLayout::I16),
        });
        session.low_latency.insert(
            CandidateSource::DeviceMix,
            Err(AUDCLNT_E_UNSUPPORTED_FORMAT),
        );
        session.shared_default.insert(
            CandidateSource::DeviceMix,
            Err(AUDCLNT_E_UNSUPPORTED_FORMAT),
        );

        let plan = negotiate_windows_stream(&mut session, false, false).expect("a stream");

        assert_eq!(plan.format.source, CandidateSource::EngineF32);
        assert_eq!(
            plan.refusals,
            vec![
                FormatRefusal {
                    source: CandidateSource::DeviceMix,
                    stage: NegotiationStage::LowLatencyInitialize,
                    hresult: AUDCLNT_E_UNSUPPORTED_FORMAT,
                },
                FormatRefusal {
                    source: CandidateSource::DeviceMix,
                    stage: NegotiationStage::SharedInitialize,
                    hresult: AUDCLNT_E_UNSUPPORTED_FORMAT,
                },
            ]
        );
        // The accepted rung ends the ladder: i16 was never offered.
        assert!(!session.calls.iter().any(|call| call.contains("EngineI16")));
    }

    #[test]
    fn a_system_without_iaudioclient3_falls_back_to_plain_shared_initialize() {
        let mut session = FakeSession::new(MIX_F32_STEREO_48K);
        session
            .periods
            .insert(CandidateSource::DeviceMix, Err(E_NOINTERFACE));

        let plan = negotiate_windows_stream(&mut session, false, false).expect("a stream");

        assert_eq!(plan.path, WindowsStreamPath::SharedDefaultPeriod);
        assert_eq!(
            plan.refusals,
            vec![FormatRefusal {
                source: CandidateSource::DeviceMix,
                stage: NegotiationStage::PeriodNegotiation,
                hresult: E_NOINTERFACE,
            }]
        );
    }

    #[test]
    fn the_forced_default_period_skips_period_negotiation_entirely() {
        // The engine's retry lever: a failed first build retries with the
        // default period, so this path must not re-run the negotiation that
        // may have caused the failure.
        let mut session = FakeSession::new(MIX_F32_STEREO_48K);

        let plan = negotiate_windows_stream(&mut session, false, true).expect("a stream");

        assert_eq!(plan.path, WindowsStreamPath::SharedDefaultPeriod);
        assert!(!session.calls.iter().any(|call| call.starts_with("periods")));
        assert!(!session
            .calls
            .iter()
            .any(|call| call.starts_with("low_latency")));
    }

    #[test]
    fn a_ladder_refused_whole_reports_every_refusal_rather_than_a_stream() {
        let mut session = FakeSession::new(MIX_F32_STEREO_48K);
        for source in [CandidateSource::DeviceMix, CandidateSource::EngineI16] {
            session
                .low_latency
                .insert(source, Err(AUDCLNT_E_UNSUPPORTED_FORMAT));
            session
                .shared_default
                .insert(source, Err(AUDCLNT_E_UNSUPPORTED_FORMAT));
        }

        let failure = negotiate_windows_stream(&mut session, false, false)
            .expect_err("no format was accepted");

        let NegotiationFailure::Exhausted { refusals } = failure else {
            panic!("an exhausted ladder is not a fatal endpoint");
        };
        assert_eq!(refusals.len(), 4);
    }

    #[test]
    fn a_device_that_vanishes_during_shared_negotiation_is_fatal() {
        let mut session = FakeSession::new(MIX_F32_STEREO_48K);
        session.low_latency.insert(
            CandidateSource::DeviceMix,
            Err(AUDCLNT_E_DEVICE_INVALIDATED),
        );

        assert_eq!(
            negotiate_windows_stream(&mut session, false, false),
            Err(NegotiationFailure::Fatal {
                hresult: AUDCLNT_E_DEVICE_INVALIDATED
            })
        );
    }

    // ---- the Exclusive opt-in ---------------------------------------------

    #[test]
    fn an_accepted_exclusive_claim_takes_the_exclusive_path() {
        let mut session = FakeSession::new(MIX_F32_STEREO_48K);

        let plan = negotiate_windows_stream(&mut session, true, false).expect("a stream");

        assert_eq!(plan.path, WindowsStreamPath::Exclusive);
        assert_eq!(plan.exclusive_degraded, None);
    }

    #[test]
    fn a_busy_device_refusing_every_exclusive_claim_degrades_observably_to_shared() {
        let mut session = FakeSession::new(MIX_F32_STEREO_48K);
        for source in [CandidateSource::DeviceMix, CandidateSource::EngineI16] {
            session
                .exclusive
                .insert(source, Err(AUDCLNT_E_DEVICE_IN_USE));
        }

        let plan = negotiate_windows_stream(&mut session, true, false).expect("a shared stream");

        // Degraded, not silent: the plan carries the refusal for the caller
        // to report, and the shared path still opened.
        assert_eq!(plan.exclusive_degraded, Some(AUDCLNT_E_DEVICE_IN_USE));
        assert_eq!(
            plan.path,
            WindowsStreamPath::SharedLowLatency { period_frames: 128 }
        );
        assert_eq!(
            plan.refusals
                .iter()
                .filter(|refusal| refusal.stage == NegotiationStage::ExclusiveClaim)
                .count(),
            2
        );
    }

    #[test]
    fn an_exclusive_format_refusal_degrades_to_shared_rather_than_failing() {
        let mut session = FakeSession::new(MIX_F32_STEREO_48K);
        for source in [CandidateSource::DeviceMix, CandidateSource::EngineI16] {
            session
                .exclusive
                .insert(source, Err(AUDCLNT_E_UNSUPPORTED_FORMAT));
        }

        let plan = negotiate_windows_stream(&mut session, true, false).expect("a shared stream");

        assert_eq!(plan.exclusive_degraded, Some(AUDCLNT_E_UNSUPPORTED_FORMAT));
        assert_ne!(plan.path, WindowsStreamPath::Exclusive);
    }

    #[test]
    fn a_device_that_vanished_during_the_exclusive_claim_is_fatal_not_degraded() {
        let mut session = FakeSession::new(MIX_F32_STEREO_48K);
        session.exclusive.insert(
            CandidateSource::DeviceMix,
            Err(AUDCLNT_E_DEVICE_INVALIDATED),
        );

        assert_eq!(
            negotiate_windows_stream(&mut session, true, false),
            Err(NegotiationFailure::Fatal {
                hresult: AUDCLNT_E_DEVICE_INVALIDATED
            })
        );
    }

    #[test]
    fn the_exclusive_degrade_decision_separates_confined_refusals_from_a_dead_endpoint() {
        assert_eq!(
            exclusive_claim_outcome(Ok(())),
            ExclusiveClaimOutcome::UseExclusive
        );
        for confined in [
            AUDCLNT_E_DEVICE_IN_USE,
            AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED,
            AUDCLNT_E_UNSUPPORTED_FORMAT,
        ] {
            assert_eq!(
                exclusive_claim_outcome(Err(confined)),
                ExclusiveClaimOutcome::DegradeToShared { hresult: confined }
            );
        }
        for dead in [AUDCLNT_E_DEVICE_INVALIDATED, AUDCLNT_E_SERVICE_NOT_RUNNING] {
            assert_eq!(
                exclusive_claim_outcome(Err(dead)),
                ExclusiveClaimOutcome::Fail { hresult: dead }
            );
        }
    }

    // ---- error taxonomy ----------------------------------------------------

    #[test]
    fn each_hresult_family_maps_onto_its_engine_stream_error_kind() {
        assert_eq!(
            stream_error_kind_for_hresult(AUDCLNT_E_DEVICE_INVALIDATED),
            StreamErrorKind::DeviceNotAvailable
        );
        assert_eq!(
            stream_error_kind_for_hresult(AUDCLNT_E_DEVICE_IN_USE),
            StreamErrorKind::DeviceBusy
        );
        assert_eq!(
            stream_error_kind_for_hresult(AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED),
            StreamErrorKind::DeviceBusy
        );
        assert_eq!(
            stream_error_kind_for_hresult(AUDCLNT_E_UNSUPPORTED_FORMAT),
            StreamErrorKind::StreamInvalidated
        );
        assert_eq!(
            stream_error_kind_for_hresult(AUDCLNT_E_SERVICE_NOT_RUNNING),
            StreamErrorKind::DeviceNotAvailable
        );
    }

    #[test]
    fn an_unmapped_hresult_reports_as_backend_specific_rather_than_vanishing() {
        // E_FAIL and a made-up code: both must surface, not disappear.
        assert_eq!(
            stream_error_kind_for_hresult(0x8000_4005_u32 as i32),
            StreamErrorKind::BackendSpecific
        );
        assert_eq!(
            stream_error_kind_for_hresult(0x8889_00FF_u32 as i32),
            StreamErrorKind::BackendSpecific
        );
    }
}
