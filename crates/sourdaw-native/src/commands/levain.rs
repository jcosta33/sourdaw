//! The control-side Levain sample-bank store, and the three commands that
//! fill it.
//!
//! A sampler sounds the bank loaded into it and nothing else, and loading one
//! is a sequence of allocations the audio thread may not perform (ADR 0020).
//! So the renderer stages a bank here — `begin_levain_bank`, one
//! `register_levain_sample` per decoded file, `commit_levain_bank` carrying the
//! zone layout — and the graph mapper builds each Levain device's instance from
//! the committed bank at strip construction (`commands::graph::map_device`).
//!
//! ## One vocabulary, two runtimes
//!
//! The field names a bank arrives under are the worklet's own upload protocol
//! (`src/modules/Levain/repositories/sampleLoader/loadInstrumentFromManifest.ts`
//! posts them; `src/modules/AudioEngine/services/levainProcessor.ts` translates
//! them into `LevainInstance` calls). This store accepts the same field
//! vocabulary and translates it identically, so a strip that moves between the
//! browser runtime and the native one sounds the same bank rather than a
//! second reading of it. The three string encodings the worklet translates —
//! `loopMode`, `transitionType`, `dynamic` — are ported verbatim below.
//!
//! ## Rates
//!
//! A bank is authored at whatever rate its files were decoded at, which is not
//! necessarily the rate the engine runs at. Conversion happens here, on the
//! control thread, at build time: the material is resampled once per target
//! rate and cached, because a device built at 48 kHz and another built at the
//! same rate later must not pay for the conversion twice.

use crate::state::AppState;
use audioadapter_buffers::direct::InterleavedSlice;
use daw_dsp::levain::LevainInstance;
use rubato::{
    Async, FixedAsync, Resampler, SincInterpolationParameters, SincInterpolationType,
    WindowFunction,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

/// Note-voices one natively hosted Levain can sound at once.
///
/// The figure the web runtime builds its own instance with
/// (`new LevainInstance(sampleRate, 64)`,
/// `src/modules/AudioEngine/services/levainProcessor.ts`), so a strip that
/// moves between the two runtimes steals voices at the same point. `daw-engine`
/// holds the same figure for the instance it builds when no bank is named, and
/// keeps it private; spelling it again here is what lets the two agree by
/// having read the same source rather than by one importing the other's
/// accident.
const LEVAIN_MAX_VOICES: u32 = 64;

/// How many sinc taps the bank resampler runs, and the shape of its window.
///
/// The settings `commands::speech` already resamples microphone audio with,
/// reused rather than re-tuned: a bank is converted once, off the audio thread,
/// so quality is the only axis that matters and these are the crate's own
/// high-quality defaults.
const RESAMPLER_SINC_LEN: usize = 256;
const RESAMPLER_OVERSAMPLING: usize = 256;
const RESAMPLER_CHUNK_FRAMES: usize = 1024;
const RESAMPLER_CUTOFF: f32 = 0.95;
/// The widest ratio departure from the nominal one the resampler is built to
/// accept. The ratio never moves after construction here, so this is headroom
/// the crate requires rather than a range this caller uses.
const RESAMPLER_MAX_RELATIVE_RATIO: f64 = 2.0;

// ── Wire layout ─────────────────────────────────────────────────────────────

/// One zone of a committed bank, in the worklet's `addZone` vocabulary.
///
/// `zoneId` is absent on purpose: the worklet numbers zones by the order it
/// posts them (`loadInstrumentFromManifest.ts` increments a local counter), so
/// the array's own order is the numbering and a second copy of it on the wire
/// could only disagree with itself.
///
/// `tuneCents`, `isRelease` and `loopMode` default because the worklet's own
/// message type marks them optional and reads an absent one as `0`, `false` and
/// "no loop" respectively.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LevainZone {
    sample_id: String,
    articulation_id: u16,
    root_note: u8,
    #[serde(default)]
    tune_cents: f32,
    lo_key: u8,
    hi_key: u8,
    lo_vel: u8,
    hi_vel: u8,
    rr_pos: u8,
    rr_len: u8,
    mic_id: u8,
    #[serde(default)]
    is_release: bool,
    #[serde(default)]
    loop_mode: String,
    loop_start: u32,
    loop_end: u32,
    loop_crossfade: u32,
    gain_db: f32,
    attack: f32,
    decay: f32,
    sustain: f32,
    release: f32,
}

/// One recorded true-legato transition, in the worklet's
/// `addLegatoTransition` vocabulary.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LevainLegatoTransition {
    sample_id: String,
    interval: i8,
    transition_type: String,
    dynamic: String,
    crossfade_out_ms: f32,
}

/// What a commit carries: the zone map to build and the dimensions to build it
/// at.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LevainBankLayout {
    zones: Vec<LevainZone>,
    legato_transitions: Vec<LevainLegatoTransition>,
    num_articulations: u32,
    num_mics: u32,
}

/// `LoopMode` as the worklet encodes it (`levainProcessor.ts`, the `addZone`
/// arm): the name crosses rather than the discriminant, so a mismatch is a
/// name rather than a silently wrong loop. An unrecognised name is "no loop",
/// which is the worklet's own fallthrough.
fn loop_mode_id(name: &str) -> u8 {
    match name {
        "forward" => 1,
        "pingpong" => 2,
        _ => 0,
    }
}

/// `LEGATO_TRANSITION_TYPE_IDS`, ported verbatim from `levainProcessor.ts`.
/// An unrecognised name is `slurred`, the worklet's own `?? 0`.
fn legato_transition_type_id(name: &str) -> u8 {
    match name {
        "portamento" => 1,
        _ => 0,
    }
}

/// `LEGATO_DYNAMIC_IDS`, ported verbatim from `levainProcessor.ts`. An
/// unrecognised name is `pp`, the worklet's own `?? 0`.
fn legato_dynamic_id(name: &str) -> u8 {
    match name {
        "p" => 1,
        "mp" => 2,
        "mf" => 3,
        "f" => 4,
        "ff" => 5,
        _ => 0,
    }
}

// ── Store ───────────────────────────────────────────────────────────────────

/// One registered file of a bank: the PCM as the renderer decoded it, plus the
/// conversions of it a build has already paid for.
#[derive(Debug)]
struct LevainBankSample {
    sample_rate: u32,
    channels: u8,
    interleaved: Arc<[f32]>,
    /// Interleaved PCM at each engine rate a build has asked for. Shared, not
    /// owned: two devices built at one rate hold the same allocation, which is
    /// what keeps a second strip carrying the same instrument free.
    resampled: HashMap<u32, Arc<[f32]>>,
}

impl LevainBankSample {
    /// This material at `to_hz`, converting and caching on first ask.
    fn data_at(&mut self, to_hz: u32) -> Result<Arc<[f32]>, String> {
        if self.sample_rate == to_hz {
            return Ok(Arc::clone(&self.interleaved));
        }
        if let Some(cached) = self.resampled.get(&to_hz) {
            return Ok(Arc::clone(cached));
        }
        let (converted, _frames) =
            resample_interleaved(&self.interleaved, self.channels, self.sample_rate, to_hz)?;
        let converted: Arc<[f32]> = Arc::from(converted);
        self.resampled.insert(to_hz, Arc::clone(&converted));
        Ok(converted)
    }

    /// Decoded bytes this sample holds as registered.
    fn byte_len(&self) -> usize {
        self.interleaved.len() * std::mem::size_of::<f32>()
    }
}

/// One bank, staged or committed.
#[derive(Debug)]
struct LevainBank {
    instrument_id: String,
    samples: HashMap<String, LevainBankSample>,
    /// `None` until `commit` takes a layout. A bank with no layout has no zone
    /// map, so nothing built from it could sound — which is why building one
    /// refuses rather than returning a silent instance.
    layout: Option<LevainBankLayout>,
}

/// Every Levain bank this process holds, keyed by the bank key the renderer
/// names (the same key its worklet-side cache is keyed by).
///
/// Control-side only. The audio thread never reaches it: what crosses to the
/// engine is a fully built `LevainInstance`, constructed here.
#[derive(Debug, Default)]
pub struct LevainBankStore {
    banks: HashMap<String, LevainBank>,
}

impl LevainBankStore {
    /// Open an empty bank under `bank_key`, replacing whatever stood there.
    ///
    /// Replacing rather than refusing: the key names the bank's identity, and
    /// the renderer owns when that identity changes — the same law
    /// `register_timeline_sample` applies to a source id.
    pub fn begin(&mut self, bank_key: &str, instrument_id: &str) -> Result<(), String> {
        if bank_key.is_empty() {
            return Err("Levain bank key must not be empty".to_string());
        }
        if instrument_id.is_empty() {
            return Err(format!(
                "levain bank '{bank_key}' names an empty instrument id"
            ));
        }
        self.banks.insert(
            bank_key.to_string(),
            LevainBank {
                instrument_id: instrument_id.to_string(),
                samples: HashMap::new(),
                layout: None,
            },
        );
        Ok(())
    }

    /// Register one decoded file into a staged bank. `pcm` is interleaved f32
    /// little-endian, exactly as `register_timeline_sample` takes it.
    fn add_sample(
        &mut self,
        bank_key: &str,
        sample_id: &str,
        sample_rate: f64,
        channels: u32,
        pcm: &[u8],
    ) -> Result<usize, String> {
        if sample_id.is_empty() {
            return Err(format!(
                "levain bank '{bank_key}' was handed a sample with an empty id"
            ));
        }
        if !(sample_rate.is_finite() && sample_rate > 0.0) {
            return Err(format!(
                "levain bank '{bank_key}' sample '{sample_id}': sample rate must be a positive, \
                 finite number"
            ));
        }
        let channels = match channels {
            1 | 2 => channels as usize,
            other => {
                return Err(format!(
                    "levain bank '{bank_key}' sample '{sample_id}': unsupported channel count \
                     {other} (mono or stereo)"
                ))
            }
        };
        let frames = crate::commands::graph::pcm_frame_count(pcm.len(), channels)
            .map_err(|reason| format!("levain bank '{bank_key}' sample '{sample_id}': {reason}"))?;

        let bank = self.staged_mut(bank_key)?;
        if bank.samples.contains_key(sample_id) {
            return Err(format!(
                "levain bank '{bank_key}' already holds a sample under id '{sample_id}'"
            ));
        }
        let interleaved: Arc<[f32]> = pcm
            .chunks_exact(4)
            .map(|word| f32::from_le_bytes([word[0], word[1], word[2], word[3]]))
            .collect();
        bank.samples.insert(
            sample_id.to_string(),
            LevainBankSample {
                sample_rate: sample_rate.round() as u32,
                channels: channels as u8,
                interleaved,
                resampled: HashMap::new(),
            },
        );
        Ok(frames)
    }

    /// Close a staged bank against its layout, refusing anything a build could
    /// only discover as a missing zone.
    fn commit(&mut self, bank_key: &str, layout: LevainBankLayout) -> Result<Value, String> {
        if layout.num_articulations < 1 {
            return Err(format!(
                "levain bank '{bank_key}' declares {} articulations; a bank holds at least one",
                layout.num_articulations
            ));
        }
        if layout.num_mics < 1 {
            return Err(format!(
                "levain bank '{bank_key}' declares {} mic positions; a bank holds at least one",
                layout.num_mics
            ));
        }
        let bank = self.staged_mut(bank_key)?;
        for zone in &layout.zones {
            if !bank.samples.contains_key(&zone.sample_id) {
                return Err(format!(
                    "levain bank '{bank_key}' has a zone naming sample '{}', which is not \
                     registered in it",
                    zone.sample_id
                ));
            }
        }
        for transition in &layout.legato_transitions {
            if !bank.samples.contains_key(&transition.sample_id) {
                return Err(format!(
                    "levain bank '{bank_key}' has a legato transition naming sample '{}', which \
                     is not registered in it",
                    transition.sample_id
                ));
            }
        }
        let ack = serde_json::json!({
            "samples": bank.samples.len(),
            "zones": layout.zones.len(),
            "legatoTransitions": layout.legato_transitions.len(),
            "bytes": bank.samples.values().map(LevainBankSample::byte_len).sum::<usize>(),
        });
        bank.layout = Some(layout);
        Ok(ack)
    }

    /// Whether `bank_key` names a bank a device could be built from.
    pub fn is_committed(&self, bank_key: &str) -> bool {
        self.banks
            .get(bank_key)
            .is_some_and(|bank| bank.layout.is_some())
    }

    /// Build one loaded `LevainInstance` from a committed bank, at the
    /// engine's own rate.
    ///
    /// The bank is staged into the instance directly rather than through
    /// `publish_sample_bank` / `attach_sample_bank`: that pair shares a bank
    /// between instances through a *thread-local* registry, which is the
    /// worklet's situation and not this one — every instance here is built on
    /// whichever control thread took the batch, so a publication would be
    /// invisible to the next build as often as not. The `Arc` cache above is
    /// what makes a second build of the same bank cheap instead.
    pub fn build_instance(
        &mut self,
        bank_key: &str,
        sample_rate: f32,
    ) -> Result<LevainInstance, String> {
        if !(sample_rate.is_finite() && sample_rate > 0.0) {
            return Err(format!(
                "levain bank '{bank_key}' cannot build at sample rate {sample_rate}"
            ));
        }
        let engine_rate = sample_rate.round() as u32;
        let bank = self
            .banks
            .get_mut(bank_key)
            .ok_or_else(|| format!("levain bank '{bank_key}' is not registered in this process"))?;
        // Field-wise so the layout can be read while the samples are converted
        // in place.
        let LevainBank {
            instrument_id,
            samples,
            layout,
        } = bank;
        let Some(layout) = layout.as_ref() else {
            return Err(format!(
                "levain bank '{bank_key}' has not been committed, so it holds no zone map"
            ));
        };

        let mut instance = LevainInstance::new(sample_rate, LEVAIN_MAX_VOICES);
        instance.begin_sample_bank(instrument_id);

        // Sorted, because `add_sample` hands back the engine's own ascending
        // ids: a build that walked the map's iteration order would number the
        // same bank differently from one run to the next, and a zone's sample
        // is addressed by that number.
        let mut sample_ids: Vec<String> = samples.keys().cloned().collect();
        sample_ids.sort_unstable();
        let mut engine_ids: HashMap<String, u32> = HashMap::new();
        for sample_id in &sample_ids {
            let sample = samples
                .get_mut(sample_id)
                .expect("the id came from this map's own keys");
            let channels = sample.channels;
            let data = sample.data_at(engine_rate)?;
            let frames = data.len() / channels as usize;
            let engine_id = instance
                .add_sample(data.to_vec(), frames as u32, channels, sample_rate)
                .ok_or_else(|| {
                    format!("levain bank '{bank_key}': the instrument refused sample '{sample_id}'")
                })?;
            engine_ids.insert(sample_id.clone(), engine_id);
        }

        for (index, zone) in layout.zones.iter().enumerate() {
            let engine_id = *engine_ids.get(&zone.sample_id).ok_or_else(|| {
                format!(
                    "levain bank '{bank_key}': zone {index} names sample '{}', which is not \
                     registered in it",
                    zone.sample_id
                )
            })?;
            // The authored loop points are frame indices into the material as
            // decoded, so a converted sample moves them with it — the same
            // rounding the conversion sizes its own output by, which is what
            // keeps a "loop to sample end" zone ending exactly at the converted
            // end.
            let from_hz = samples
                .get(&zone.sample_id)
                .expect("the commit proved every zone's sample is registered")
                .sample_rate;
            instance.add_zone(
                index as u32,
                engine_id,
                zone.articulation_id,
                zone.root_note,
                zone.tune_cents,
                zone.lo_key,
                zone.hi_key,
                zone.lo_vel,
                zone.hi_vel,
                zone.rr_pos,
                zone.rr_len,
                zone.mic_id,
                zone.is_release,
                loop_mode_id(&zone.loop_mode),
                scale_frames(zone.loop_start, from_hz, engine_rate),
                scale_frames(zone.loop_end, from_hz, engine_rate),
                scale_frames(zone.loop_crossfade, from_hz, engine_rate),
                zone.gain_db,
                zone.attack,
                zone.decay,
                zone.sustain,
                zone.release,
            );
        }

        for transition in &layout.legato_transitions {
            let engine_id = *engine_ids.get(&transition.sample_id).ok_or_else(|| {
                format!(
                    "levain bank '{bank_key}': a legato transition names sample '{}', which is \
                     not registered in it",
                    transition.sample_id
                )
            })?;
            instance.add_legato_transition(
                transition.interval,
                legato_transition_type_id(&transition.transition_type),
                legato_dynamic_id(&transition.dynamic),
                engine_id,
                transition.crossfade_out_ms,
            );
        }

        if !instance.build_zone_map(layout.num_articulations, layout.num_mics) {
            return Err(format!(
                "levain bank '{bank_key}': the instrument refused the zone map at {} \
                 articulations and {} mic positions",
                layout.num_articulations, layout.num_mics
            ));
        }
        if !instance.commit_sample_bank() {
            return Err(format!(
                "levain bank '{bank_key}': the instrument refused to commit the staged bank"
            ));
        }
        Ok(instance)
    }

    /// The bank under `bank_key`, refusing one that does not exist or that a
    /// commit has already closed.
    fn staged_mut(&mut self, bank_key: &str) -> Result<&mut LevainBank, String> {
        let bank = self.banks.get_mut(bank_key).ok_or_else(|| {
            format!("levain bank '{bank_key}' has not been opened in this process")
        })?;
        if bank.layout.is_some() {
            return Err(format!(
                "levain bank '{bank_key}' is already committed; open it again to replace it"
            ));
        }
        Ok(bank)
    }
}

/// Where a frame index in material at `from_hz` lands once the material is
/// converted to `to_hz`.
///
/// The same rounding [`resample_interleaved`] sizes its output by, so the last
/// frame of a sample maps onto the last frame of its conversion.
fn scale_frames(frame: u32, from_hz: u32, to_hz: u32) -> u32 {
    if from_hz == to_hz {
        return frame;
    }
    (f64::from(frame) * f64::from(to_hz) / f64::from(from_hz)).round() as u32
}

/// Convert interleaved PCM from `from_hz` to `to_hz`, preserving channel
/// identity and answering exactly `round(frames · to / from)` frames.
///
/// The resampler reports its own group delay and `process_all_into_buffer`
/// trims it, but the trimmed length is the crate's own rounding of the ratio
/// rather than this caller's: the result is trimmed or zero-padded to the
/// frame count the loop points above are scaled by, so the two can never
/// disagree.
///
/// Deinterleaving is the adapter's job: `InterleavedSlice` presents the buffer
/// to rubato as channels, and the output adapter writes the converted channels
/// back interleaved, so no intermediate planar copy of the bank exists.
fn resample_interleaved(
    input: &[f32],
    channels: u8,
    from_hz: u32,
    to_hz: u32,
) -> Result<(Vec<f32>, u32), String> {
    let channels = channels as usize;
    debug_assert_ne!(
        from_hz, to_hz,
        "a same-rate conversion is a caller defect: the material is already at the target rate"
    );
    let frames = input.len() / channels;
    if from_hz == to_hz || frames == 0 {
        return Ok((input.to_vec(), frames as u32));
    }
    let target_frames = scale_frames(frames as u32, from_hz, to_hz) as usize;

    let parameters = SincInterpolationParameters {
        sinc_len: RESAMPLER_SINC_LEN,
        f_cutoff: Some(RESAMPLER_CUTOFF),
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: RESAMPLER_OVERSAMPLING,
        window: WindowFunction::BlackmanHarris2,
    };
    let ratio = f64::from(to_hz) / f64::from(from_hz);
    let mut resampler = Async::<f32>::new_sinc(
        ratio,
        RESAMPLER_MAX_RELATIVE_RATIO,
        &parameters,
        RESAMPLER_CHUNK_FRAMES,
        channels,
        FixedAsync::Input,
    )
    .map_err(|error| format!("Failed to create the levain bank resampler: {error}"))?;

    let needed = resampler.process_all_needed_output_len(frames);
    let source = InterleavedSlice::new(input, channels, frames)
        .map_err(|error| format!("Levain bank resampler input error: {error}"))?;
    let mut converted = vec![0.0_f32; needed * channels];
    let mut destination = InterleavedSlice::new_mut(converted.as_mut_slice(), channels, needed)
        .map_err(|error| format!("Levain bank resampler output error: {error}"))?;
    let (_taken, produced) = resampler
        .process_all_into_buffer(&source, &mut destination, frames, None)
        .map_err(|error| format!("Levain bank resample error: {error}"))?;

    converted.truncate(produced.min(target_frames) * channels);
    converted.resize(target_frames * channels, 0.0);
    Ok((converted, target_frames as u32))
}

// ── Command bodies ──────────────────────────────────────────────────────────

/// Open an empty Levain bank under `bank_key`, replacing any bank already
/// there. Returns `{ "bankKey": … }`.
pub async fn begin_levain_bank(
    bank_key: String,
    instrument_id: String,
    state: &AppState,
) -> Result<Value, String> {
    let mut banks = state
        .levain_banks
        .lock()
        .map_err(|error| format!("Failed to lock levain banks: {error}"))?;
    banks.begin(&bank_key, &instrument_id)?;
    Ok(serde_json::json!({ "bankKey": bank_key }))
}

/// Register one decoded file into a staged Levain bank. `pcm` is interleaved
/// f32 little-endian at `sample_rate`, `channels` 1 or 2. Returns
/// `{ "frames": n }`.
pub async fn register_levain_sample(
    bank_key: String,
    sample_id: String,
    sample_rate: f64,
    channels: u32,
    pcm: Vec<u8>,
    state: &AppState,
) -> Result<Value, String> {
    let mut banks = state
        .levain_banks
        .lock()
        .map_err(|error| format!("Failed to lock levain banks: {error}"))?;
    let frames = banks.add_sample(&bank_key, &sample_id, sample_rate, channels, &pcm)?;
    Ok(serde_json::json!({ "frames": frames }))
}

/// Close a staged Levain bank against its zone layout, after which a device
/// naming this bank key can be built. Returns the bank's own totals.
pub async fn commit_levain_bank(
    bank_key: String,
    layout: Value,
    state: &AppState,
) -> Result<Value, String> {
    let layout: LevainBankLayout = serde_json::from_value(layout).map_err(|error| {
        format!("levain bank '{bank_key}' carries a layout this backend cannot read: {error}")
    })?;
    let mut banks = state
        .levain_banks
        .lock()
        .map_err(|error| format!("Failed to lock levain banks: {error}"))?;
    banks.commit(&bank_key, layout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block_on_test;
    use serde_json::json;

    const BANK: &str = "strings@1";
    const SAMPLE: &str = "a3.wav";
    const NOTE: u8 = 69;
    const VELOCITY: u8 = 100;
    const RUN_FRAMES: usize = 128;

    /// One second of a 440 Hz sine at `rate`, mono, with 5 ms fades so the
    /// material has no edge transient of its own to mistake for content.
    fn sine(rate: u32) -> Vec<f32> {
        let frames = rate as usize;
        let fade = (rate as f32 * 0.005) as usize;
        (0..frames)
            .map(|frame| {
                let phase = std::f32::consts::TAU * 440.0 * (frame as f32) / (rate as f32);
                let gain = (frame.min(frames - 1 - frame) as f32 / fade as f32).min(1.0);
                phase.sin() * gain
            })
            .collect()
    }

    fn pcm_bytes(samples: &[f32]) -> Vec<u8> {
        samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect()
    }

    /// The one-zone layout every case here commits: full key and velocity
    /// range, no loop, and an envelope that opens instantly so a render of a
    /// few runs already carries the sample.
    fn one_zone_layout(sample_id: &str) -> Value {
        json!({
            "zones": [{
                "sampleId": sample_id,
                "articulationId": 0,
                "rootNote": NOTE,
                "loKey": 0,
                "hiKey": 127,
                "loVel": 0,
                "hiVel": 127,
                "rrPos": 0,
                "rrLen": 1,
                "micId": 0,
                "isRelease": false,
                "loopMode": "none",
                "loopStart": 0,
                "loopEnd": 0,
                "loopCrossfade": 0,
                "gainDb": 0.0,
                "attack": 0.0,
                "decay": 0.0,
                "sustain": 1.0,
                "release": 0.05
            }],
            "legatoTransitions": [],
            "numArticulations": 1,
            "numMics": 1
        })
    }

    /// A store holding one committed mono bank authored at `rate`.
    fn committed_bank(rate: u32) -> LevainBankStore {
        let mut store = LevainBankStore::default();
        store.begin(BANK, "strings").expect("the bank opens");
        store
            .add_sample(BANK, SAMPLE, f64::from(rate), 1, &pcm_bytes(&sine(rate)))
            .expect("the bank takes its one sample");
        store
            .commit(
                BANK,
                serde_json::from_value(one_zone_layout(SAMPLE)).expect("the layout reads"),
            )
            .expect("the bank commits");
        store
    }

    /// `frames` rendered from `instance`, driven the way the native body drives
    /// it: one `process` call per run, reading both channel buffers after it.
    fn render(instance: &mut LevainInstance, frames: usize) -> (Vec<f32>, Vec<f32>) {
        let mut left = Vec::with_capacity(frames);
        let mut right = Vec::with_capacity(frames);
        let mut rendered = 0;
        while rendered < frames {
            let run = (frames - rendered).min(RUN_FRAMES);
            let rendered_left = instance.process(run as u32);
            let rendered_right = instance.get_right_ptr();
            // SAFETY: both pointers name the instrument's own channel buffers,
            // sized at `LEVAIN_BLOCK_FRAMES` by its constructor and never
            // resized; `run` is at most `RUN_FRAMES`, well inside that. The
            // buffers are separate allocations, and nothing mutates the
            // instrument between the render and these reads.
            unsafe {
                left.extend_from_slice(std::slice::from_raw_parts(rendered_left, run));
                right.extend_from_slice(std::slice::from_raw_parts(rendered_right, run));
            }
            rendered += run;
        }
        (left, right)
    }

    fn peak(samples: &[f32]) -> f32 {
        samples
            .iter()
            .fold(0.0_f32, |loudest, sample| loudest.max(sample.abs()))
    }

    /// The frequency implied by the rising zero crossings in `samples`,
    /// rendered at `rate`.
    fn implied_frequency(samples: &[f32], rate: f32) -> f32 {
        let mut first = None;
        let mut last = 0usize;
        let mut crossings = 0usize;
        for index in 1..samples.len() {
            if samples[index - 1] <= 0.0 && samples[index] > 0.0 {
                if first.is_none() {
                    first = Some(index);
                }
                last = index;
                crossings += 1;
            }
        }
        let first = first.expect("the rendered material crosses zero at least once");
        assert!(
            crossings > 2,
            "the rendered material has too few crossings to imply a frequency"
        );
        (crossings - 1) as f32 * rate / (last - first) as f32
    }

    fn within_one_percent(measured: f32, expected: f32) -> bool {
        (measured - expected).abs() / expected < 0.01
    }

    #[test]
    fn a_committed_bank_builds_an_instance_that_sounds_its_sample() {
        let mut store = committed_bank(48_000);

        let mut instance = store
            .build_instance(BANK, 48_000.0)
            .expect("a committed bank builds");
        instance.note_on_with_channel(NOTE, VELOCITY, 0);
        let (left, right) = render(&mut instance, RUN_FRAMES * 4);

        assert!(
            peak(&left) > 0.05 && peak(&right) > 0.05,
            "the built instance rendered silence, so nothing about the bank reached it: \
             left peak {}, right peak {}",
            peak(&left),
            peak(&right)
        );
    }

    #[test]
    fn a_bank_registered_at_one_rate_plays_in_tune_at_another() {
        const ENGINE_RATE: f32 = 48_000.0;
        let mut store = committed_bank(44_100);

        let mut instance = store
            .build_instance(BANK, ENGINE_RATE)
            .expect("a committed bank builds at the engine's rate");
        instance.note_on_with_channel(NOTE, VELOCITY, 0);
        let (left, _right) = render(&mut instance, 48_000);

        // Frames 4800..43200 skip the attack and the tail, so what is measured
        // is the steady part of the sample alone.
        let measured = implied_frequency(&left[4_800..43_200], ENGINE_RATE);
        assert!(
            within_one_percent(measured, 440.0),
            "the resampled bank sounded {measured} Hz, not the authored 440 Hz"
        );
        // What an unconverted build would have sounded: the sampler derives its
        // ratio from the material's declared rate against the engine's, so
        // handing 44.1 kHz material over as 48 kHz material plays it sharp by
        // exactly that ratio.
        let unconverted = 440.0 * 48_000.0 / 44_100.0;
        assert!(
            !within_one_percent(measured, unconverted),
            "the measured {measured} Hz is the unconverted figure {unconverted} Hz, so the \
             conversion did not happen"
        );
    }

    #[test]
    fn a_second_build_at_one_rate_reuses_the_cached_conversion() {
        let mut store = committed_bank(44_100);

        store
            .build_instance(BANK, 48_000.0)
            .expect("the first build converts");
        let first = Arc::clone(
            store.banks[BANK].samples[SAMPLE]
                .resampled
                .get(&48_000)
                .expect("the first build cached its conversion"),
        );
        store
            .build_instance(BANK, 48_000.0)
            .expect("the second build reuses");
        let second = Arc::clone(
            store.banks[BANK].samples[SAMPLE]
                .resampled
                .get(&48_000)
                .expect("the cache survives a second build"),
        );

        assert!(
            Arc::ptr_eq(&first, &second),
            "the second build converted the material again instead of reusing the cache"
        );
    }

    #[test]
    fn a_layout_naming_an_unregistered_sample_refuses_to_commit() {
        let mut store = LevainBankStore::default();
        store.begin(BANK, "strings").expect("the bank opens");
        store
            .add_sample(BANK, SAMPLE, 48_000.0, 1, &pcm_bytes(&sine(48_000)))
            .expect("the bank takes its one sample");

        let refusal = store
            .commit(
                BANK,
                serde_json::from_value(one_zone_layout("c4.wav")).expect("the layout reads"),
            )
            .expect_err("a layout naming material the bank never took must refuse");

        assert!(
            refusal.contains("c4.wav") && refusal.contains(BANK),
            "the refusal must name the sample and the bank, got: {refusal}"
        );
    }

    #[test]
    fn a_sample_after_commit_refuses() {
        let mut store = committed_bank(48_000);

        let refusal = store
            .add_sample(BANK, "b3.wav", 48_000.0, 1, &pcm_bytes(&sine(48_000)))
            .expect_err("a committed bank must not take further material");

        assert!(
            refusal.contains(BANK),
            "the refusal must name the bank, got: {refusal}"
        );
    }

    #[test]
    fn a_duplicate_sample_id_refuses() {
        let mut store = LevainBankStore::default();
        store.begin(BANK, "strings").expect("the bank opens");
        store
            .add_sample(BANK, SAMPLE, 48_000.0, 1, &pcm_bytes(&sine(48_000)))
            .expect("the bank takes its one sample");

        let refusal = store
            .add_sample(BANK, SAMPLE, 48_000.0, 1, &pcm_bytes(&sine(48_000)))
            .expect_err("a second registration under one id must refuse");

        assert!(
            refusal.contains(BANK) && refusal.contains(SAMPLE),
            "the refusal must name the bank and the sample, got: {refusal}"
        );
    }

    /// Why a build refused. `LevainInstance` carries no `Debug`, so
    /// `expect_err` is unavailable and the refusal is taken by pattern.
    fn build_refusal(store: &mut LevainBankStore, why: &str) -> String {
        match store.build_instance(BANK, 48_000.0) {
            Ok(_) => panic!("{why}"),
            Err(refusal) => refusal,
        }
    }

    #[test]
    fn an_unknown_bank_refuses_to_build() {
        let refusal = build_refusal(
            &mut LevainBankStore::default(),
            "a bank this process never held must refuse to build",
        );

        assert!(
            refusal.contains(BANK),
            "the refusal must name the bank, got: {refusal}"
        );
    }

    #[test]
    fn an_uncommitted_bank_refuses_to_build() {
        let mut store = LevainBankStore::default();
        store.begin(BANK, "strings").expect("the bank opens");
        store
            .add_sample(BANK, SAMPLE, 48_000.0, 1, &pcm_bytes(&sine(48_000)))
            .expect("the bank takes its one sample");

        let refusal = build_refusal(&mut store, "a bank with no zone map must refuse to build");

        assert!(
            refusal.contains(BANK),
            "the refusal must name the bank, got: {refusal}"
        );
    }

    #[test]
    fn begin_replaces_an_earlier_bank_under_the_same_key() {
        let mut store = committed_bank(48_000);
        store
            .build_instance(BANK, 48_000.0)
            .expect("the first bank builds");

        store.begin(BANK, "strings").expect("the bank reopens");

        let refusal = build_refusal(
            &mut store,
            "the replacement bank holds no zone map until it commits",
        );
        assert!(
            refusal.contains(BANK),
            "the refusal must name the bank, got: {refusal}"
        );

        store
            .add_sample(BANK, SAMPLE, 48_000.0, 1, &pcm_bytes(&sine(48_000)))
            .expect("the replacement takes its sample");
        store
            .commit(
                BANK,
                serde_json::from_value(one_zone_layout(SAMPLE)).expect("the layout reads"),
            )
            .expect("the replacement commits");
        store
            .build_instance(BANK, 48_000.0)
            .expect("the replacement builds once it is committed");
    }

    #[test]
    fn resample_interleaved_keeps_channel_identity() {
        const FRAMES: usize = 4_410;
        let mut input = vec![0.0_f32; FRAMES * 2];
        for frame in 0..FRAMES {
            input[frame * 2] = frame as f32 / FRAMES as f32;
        }

        let (converted, frames) =
            resample_interleaved(&input, 2, 44_100, 48_000).expect("the conversion runs");

        assert_eq!(
            frames as usize,
            (FRAMES as f64 * 48_000.0 / 44_100.0).round() as usize,
            "the conversion answered a frame count the loop-point scaling would disagree with"
        );
        assert_eq!(converted.len(), frames as usize * 2);
        assert!(
            converted
                .iter()
                .skip(1)
                .step_by(2)
                .all(|sample| *sample == 0.0),
            "the silent right channel picked up material, so the channels were crossed"
        );
        let left: Vec<f32> = converted.iter().step_by(2).copied().collect();
        let middle = &left[left.len() / 20..left.len() - left.len() / 20];
        assert!(
            middle.windows(2).all(|pair| pair[1] >= pair[0]),
            "the converted ramp is not monotonic, so the left channel is not the ramp it was"
        );
    }

    #[test]
    fn the_command_bodies_fill_the_state_the_mapper_reads() {
        let state = AppState::default();

        block_on_test(begin_levain_bank(
            BANK.to_string(),
            "strings".to_string(),
            &state,
        ))
        .expect("the begin command opens the bank");
        let registered = block_on_test(register_levain_sample(
            BANK.to_string(),
            SAMPLE.to_string(),
            48_000.0,
            1,
            pcm_bytes(&sine(48_000)),
            &state,
        ))
        .expect("the register command takes the sample");
        let committed = block_on_test(commit_levain_bank(
            BANK.to_string(),
            one_zone_layout(SAMPLE),
            &state,
        ))
        .expect("the commit command closes the bank");

        assert_eq!(registered["frames"], json!(48_000));
        assert_eq!(committed["samples"], json!(1));
        assert_eq!(committed["zones"], json!(1));
        assert_eq!(committed["legatoTransitions"], json!(0));
        assert_eq!(committed["bytes"], json!(48_000 * 4));
        assert!(
            state
                .levain_banks
                .lock()
                .expect("the bank lock opens")
                .is_committed(BANK),
            "the commands filled a store the mapper would read as holding no bank"
        );
    }
}
