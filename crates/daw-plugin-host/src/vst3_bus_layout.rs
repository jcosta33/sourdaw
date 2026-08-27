//! What this host puts on a VST3 plugin's audio buses, agreed once at
//! activation and unchanged for the instance's life.
//!
//! VST3 makes the host responsible for the whole bus picture. `ProcessData`
//! must carry *every* bus the component declared — a plugin reads
//! `numInputs`/`numOutputs` and indexes into the arrays it was given, so a host
//! that passes one bus to a plugin with two reads past the end of the host's own
//! array. And the arrangement on the main pair is whatever the host last stated
//! through `setBusArrangements`; a host that never calls it leaves a
//! surround-capable plugin on the default it shipped, which is not the stereo
//! pair the engine's plugin slots carry.
//!
//! The layout is therefore read, negotiated and frozen here, before the first
//! block. Everything the audio thread needs is a plain channel count it can
//! index; nothing in this module runs on the audio thread.

use vst3::ComPtr;
use vst3::Steinberg::Vst::{
    BusDirections_, BusInfo, BusTypes_, IAudioProcessor, IAudioProcessorTrait, IComponent,
    IComponentTrait, MediaTypes_, SpeakerArr, SpeakerArrangement,
};
use vst3::Steinberg::{int32, kResultOk};

/// Channels the engine's plugin slots carry, and therefore the widest main bus
/// this host can feed or take.
pub const HOST_CHANNELS: usize = 2;

/// The most audio buses, per direction, this host will read from a plugin.
///
/// `getBusCount` is a plugin-supplied `int32`, so it is an untrusted loop bound
/// and an untrusted allocation size. Real plugins declare a handful; the bound
/// is the scanner's, for the same reason.
const MAX_AUDIO_BUSES: int32 = 64;

/// One declared audio bus, in the terms a block needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BusGeometry {
    /// Channels the plugin accepted for this bus.
    pub channels: usize,
    /// Whether the host's own scratch is mapped onto this bus. Exactly one bus
    /// per direction is the main one; every other is declared and fed nothing.
    pub is_main: bool,
}

/// Every audio bus one activated instance runs with, in declaration order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BusLayout {
    pub inputs: Vec<BusGeometry>,
    pub outputs: Vec<BusGeometry>,
}

impl BusLayout {
    /// Channels the host writes into the main input bus, zero when the plugin
    /// declares no audio input at all — which is what an instrument does.
    pub fn main_input_channels(&self) -> usize {
        main_channels(&self.inputs)
    }

    /// Channels the host reads back from the main output bus.
    pub fn main_output_channels(&self) -> usize {
        main_channels(&self.outputs)
    }
}

fn main_channels(buses: &[BusGeometry]) -> usize {
    buses
        .iter()
        .find(|bus| bus.is_main)
        .map_or(0, |bus| bus.channels)
}

/// The arrangement this host states for a main bus of the given width.
///
/// Only mono and stereo have a spelling here because only those two are widths
/// the engine's slots can carry; anything else is a bus this host has no signal
/// for, and `kEmpty` says exactly that rather than naming a layout it cannot
/// fill.
pub fn host_arrangement(channels: usize) -> SpeakerArrangement {
    match channels {
        1 => SpeakerArr::kMono,
        2 => SpeakerArr::kStereo,
        _ => SpeakerArr::kEmpty,
    }
}

/// How many channels an arrangement carries. VST3 arrangements are a speaker
/// bitmask, so the channel count is the number of speakers set.
pub fn arrangement_channels(arrangement: SpeakerArrangement) -> usize {
    arrangement.count_ones() as usize
}

/// The main-bus widths to offer a plugin, most preferred first.
///
/// The plugin's own declaration comes first — clamped to what the host can
/// carry, which is the whole point of negotiating with a surround-capable
/// plugin — and the other width this host can feed comes second, so a plugin
/// that will only run mono still gets an offer it can accept.
pub fn main_bus_candidates(declared_channels: usize) -> Vec<usize> {
    if declared_channels == 0 {
        return Vec::new();
    }
    let preferred = declared_channels.clamp(1, HOST_CHANNELS);
    let alternative = if preferred == 1 { HOST_CHANNELS } else { 1 };
    vec![preferred, alternative]
}

/// The silence flags for a bus the host declares but hands no buffers.
///
/// One bit per channel. A bus passed with a null `channelBuffers32` and no
/// silence flags claims the plugin may read it, which is exactly the read this
/// host has no memory for.
pub fn silent_channel_flags(channels: usize) -> u64 {
    if channels >= u64::BITS as usize {
        return u64::MAX;
    }
    (1u64 << channels) - 1
}

/// What the component says about one audio bus before anything is negotiated.
struct DeclaredBus {
    channels: usize,
    is_main: bool,
    arrangement: SpeakerArrangement,
}

/// Read the plugin's audio bus declaration, agree an arrangement the host can
/// actually feed, and freeze the result.
///
/// # Safety
/// `component` must be initialised and inactive, and `processor` must be its
/// own audio processor: `setBusArrangements` is defined only in that state.
pub unsafe fn negotiate_bus_layout(
    component: &ComPtr<IComponent>,
    processor: &ComPtr<IAudioProcessor>,
    name: &str,
) -> Result<BusLayout, String> {
    let inputs = declared_buses(component, BusDirections_::kInput as int32);
    let outputs = declared_buses(component, BusDirections_::kOutput as int32);

    negotiate_main_pair(processor, &inputs, &outputs);

    let layout = BusLayout {
        inputs: accepted_geometry(processor, &inputs, BusDirections_::kInput as int32),
        outputs: accepted_geometry(processor, &outputs, BusDirections_::kOutput as int32),
    };

    refuse_unfeedable_main_bus(&layout, name)?;
    Ok(layout)
}

/// Activate the main bus of one direction, which is the only audio bus this
/// host puts a signal on. A direction with no bus is not an error — an
/// instrument has no audio input.
///
/// # Safety
/// `component` must be initialised and inactive.
pub unsafe fn activate_main_audio_bus(component: &ComPtr<IComponent>, direction: int32) {
    let buses = declared_buses(component, direction);
    let Some(index) = buses.iter().position(|bus| bus.is_main) else {
        return;
    };
    component.activateBus(MediaTypes_::kAudio as int32, direction, index as int32, 1);
}

unsafe fn declared_buses(component: &ComPtr<IComponent>, direction: int32) -> Vec<DeclaredBus> {
    let count = component
        .getBusCount(MediaTypes_::kAudio as int32, direction)
        .clamp(0, MAX_AUDIO_BUSES);

    let mut buses: Vec<DeclaredBus> = (0..count)
        .map(|index| {
            let mut info: BusInfo = std::mem::zeroed();
            let described =
                component.getBusInfo(MediaTypes_::kAudio as int32, direction, index, &mut info)
                    == kResultOk;
            let channels = if described {
                usize::try_from(info.channelCount).unwrap_or(0)
            } else {
                0
            };
            DeclaredBus {
                channels,
                is_main: described && info.busType == BusTypes_::kMain as int32,
                arrangement: declared_arrangement(
                    processor_arrangement_of(component, direction, index),
                    channels,
                ),
            }
        })
        .collect();

    // VST3 names bus zero the main bus by convention, and a plugin that labels
    // none of its buses `kMain` still has one. Falling back to the first bus is
    // what keeps such a plugin from running with no main bus at all.
    if !buses.iter().any(|bus| bus.is_main) {
        if let Some(first) = buses.first_mut() {
            first.is_main = true;
        }
    }
    buses
}

/// The arrangement the plugin already has on a bus, when it will say.
unsafe fn processor_arrangement_of(
    component: &ComPtr<IComponent>,
    direction: int32,
    index: int32,
) -> Option<SpeakerArrangement> {
    let processor = component.cast::<IAudioProcessor>()?;
    let mut arrangement: SpeakerArrangement = SpeakerArr::kEmpty;
    (processor.getBusArrangement(direction, index, &mut arrangement) == kResultOk)
        .then_some(arrangement)
}

/// The arrangement to state for a bus the host is not changing.
///
/// `getBusArrangement` is the plugin's own answer and is preferred. A plugin
/// that will not answer it leaves only the channel count, and a bitmask of that
/// many speakers carries the same count — which is the only property this host
/// reads back out of an arrangement.
fn declared_arrangement(
    reported: Option<SpeakerArrangement>,
    channels: usize,
) -> SpeakerArrangement {
    match reported {
        Some(arrangement) if arrangement_channels(arrangement) == channels => arrangement,
        _ => silent_channel_flags(channels),
    }
}

/// State the host's main-bus widths, trying each candidate until the plugin
/// accepts one.
///
/// Non-main buses are stated at the arrangement the plugin already declared:
/// this host feeds them nothing, and asking a plugin to drop a sidechain it
/// declared is a change it has every right to refuse — which would lose the
/// main pair along with it.
unsafe fn negotiate_main_pair(
    processor: &ComPtr<IAudioProcessor>,
    inputs: &[DeclaredBus],
    outputs: &[DeclaredBus],
) {
    let input_widths = main_bus_candidates(main_declared_channels(inputs));
    let output_widths = main_bus_candidates(main_declared_channels(outputs));
    let attempts = input_widths.len().max(output_widths.len()).max(1);

    for attempt in 0..attempts {
        let mut requested_inputs =
            requested_arrangements(inputs, input_widths.get(attempt).copied());
        let mut requested_outputs =
            requested_arrangements(outputs, output_widths.get(attempt).copied());

        let accepted = processor.setBusArrangements(
            requested_inputs.as_mut_ptr(),
            requested_inputs.len() as int32,
            requested_outputs.as_mut_ptr(),
            requested_outputs.len() as int32,
        );
        if accepted == kResultOk {
            return;
        }
    }
}

fn main_declared_channels(buses: &[DeclaredBus]) -> usize {
    buses
        .iter()
        .find(|bus| bus.is_main)
        .map_or(0, |bus| bus.channels)
}

fn requested_arrangements(
    buses: &[DeclaredBus],
    main_width: Option<usize>,
) -> Vec<SpeakerArrangement> {
    buses
        .iter()
        .map(|bus| match (bus.is_main, main_width) {
            (true, Some(width)) => host_arrangement(width),
            _ => bus.arrangement,
        })
        .collect()
}

/// Read back what the plugin actually runs with, which is the only answer a
/// block may be built from — a `setBusArrangements` that returned success is
/// still allowed to have agreed to something narrower.
unsafe fn accepted_geometry(
    processor: &ComPtr<IAudioProcessor>,
    declared: &[DeclaredBus],
    direction: int32,
) -> Vec<BusGeometry> {
    declared
        .iter()
        .enumerate()
        .map(|(index, bus)| {
            let mut arrangement: SpeakerArrangement = SpeakerArr::kEmpty;
            let answered = processor.getBusArrangement(direction, index as int32, &mut arrangement)
                == kResultOk;
            BusGeometry {
                channels: if answered {
                    arrangement_channels(arrangement)
                } else {
                    bus.channels
                },
                is_main: bus.is_main,
            }
        })
        .collect()
}

fn refuse_unfeedable_main_bus(layout: &BusLayout, name: &str) -> Result<(), String> {
    for (direction, channels) in [
        ("input", layout.main_input_channels()),
        ("output", layout.main_output_channels()),
    ] {
        if channels <= HOST_CHANNELS {
            continue;
        }
        return Err(format!(
            "[VST3] '{name}' refused every main audio bus arrangement this host can feed: \
             its main {direction} bus runs {channels} channels, and the host carries mono or stereo"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The widths the host offers, in order. A plugin that declares more
    /// channels than the host carries is offered stereo first — the whole
    /// reason the host states an arrangement at all — and mono second.
    #[test]
    fn a_surround_plugin_is_offered_stereo_before_mono() {
        assert_eq!(main_bus_candidates(6), vec![2, 1]);
    }

    #[test]
    fn a_mono_plugin_is_offered_its_own_width_first() {
        assert_eq!(main_bus_candidates(1), vec![1, 2]);
    }

    /// A direction with no declared bus is offered nothing rather than an
    /// arrangement for a bus that does not exist.
    #[test]
    fn a_direction_with_no_bus_is_offered_no_arrangement() {
        assert!(main_bus_candidates(0).is_empty());
    }

    /// A VST3 arrangement is a speaker bitmask, and the channel count is the
    /// count of speakers in it — not the numeric value, which for mono is a
    /// single bit nineteen places up.
    #[test]
    fn an_arrangement_reports_the_channels_its_speakers_carry() {
        assert_eq!(arrangement_channels(SpeakerArr::kMono), 1);
        assert_eq!(arrangement_channels(SpeakerArr::kStereo), 2);
        assert_eq!(arrangement_channels(SpeakerArr::kEmpty), 0);
        assert_eq!(host_arrangement(1), SpeakerArr::kMono);
        assert_eq!(host_arrangement(2), SpeakerArr::kStereo);
        assert_eq!(host_arrangement(6), SpeakerArr::kEmpty);
    }

    /// A bus handed no buffers must be flagged silent on every channel, or the
    /// plugin is entitled to read the null pointer it was given.
    #[test]
    fn every_channel_of_an_unfed_bus_is_flagged_silent() {
        assert_eq!(silent_channel_flags(0), 0);
        assert_eq!(silent_channel_flags(1), 0b1);
        assert_eq!(silent_channel_flags(2), 0b11);
        assert_eq!(silent_channel_flags(64), u64::MAX);
        assert_eq!(silent_channel_flags(200), u64::MAX);
    }

    fn layout(input_channels: usize, output_channels: usize) -> BusLayout {
        BusLayout {
            inputs: vec![BusGeometry {
                channels: input_channels,
                is_main: true,
            }],
            outputs: vec![BusGeometry {
                channels: output_channels,
                is_main: true,
            }],
        }
    }

    /// A plugin still on a wider main bus after every offer has nowhere for the
    /// host's two channels to go, and passing it two pointers while claiming six
    /// channels is how a plugin reads memory the host never allocated.
    #[test]
    fn a_main_bus_wider_than_the_host_carries_is_refused_by_name() {
        let error = refuse_unfeedable_main_bus(&layout(2, 6), "Wide Reverb")
            .expect_err("six output channels cannot be fed");

        assert!(error.contains("Wide Reverb"), "{error}");
        assert!(error.contains("main output bus runs 6 channels"), "{error}");
    }

    #[test]
    fn mono_and_stereo_main_buses_are_accepted_and_a_missing_one_is_not_an_error() {
        assert!(refuse_unfeedable_main_bus(&layout(2, 2), "Stereo").is_ok());
        assert!(refuse_unfeedable_main_bus(&layout(1, 1), "Mono").is_ok());
        assert!(
            refuse_unfeedable_main_bus(&layout(0, 2), "Instrument").is_ok(),
            "an instrument declares no audio input bus"
        );
    }

    /// The bus the host feeds is the one the plugin marked main, and its width
    /// is what a block maps the host's scratch onto.
    #[test]
    fn the_main_bus_width_is_read_from_the_bus_the_plugin_marked_main() {
        let with_sidechain = BusLayout {
            inputs: vec![
                BusGeometry {
                    channels: 2,
                    is_main: true,
                },
                BusGeometry {
                    channels: 1,
                    is_main: false,
                },
            ],
            outputs: Vec::new(),
        };

        assert_eq!(with_sidechain.main_input_channels(), 2);
        assert_eq!(
            with_sidechain.main_output_channels(),
            0,
            "a direction with no bus has no main width"
        );
    }
}
