//! The VST3 descriptor extractor: what a scan learns about a `.vst3` bundle.
//!
//! Two entry points, matching the two the scan worker registry asks every format
//! for. [`extract_vst3_metadata`] reads the bundle's own description of itself;
//! [`extract_vst3_instance_metadata`] creates one live, *unactivated* instance
//! and asks it. Both run only inside the bounded scan worker, because both can
//! end up executing the plugin's code.

use crate::scanner::{
    PluginFormat, ScannedAudioChannelCounts, ScannedDescriptor, ScannedInstance,
    ScannedInstanceCapabilities, ScannedParameterDescriptor,
};
use crate::vst3_class_id::normalized_class_id;
use crate::vst3_module::{factory_info, Vst3Module};
use crate::vst3_module_info::{parse_module_info, ModuleInfo};
use crate::vst3_wrapper::{format_class_id, read_parameters, Vst3Instance};
use std::path::Path;
use vst3::ComPtr;
use vst3::Steinberg::Vst::{BusDirections_, BusInfo, IComponentTrait, MediaTypes_};
use vst3::Steinberg::{
    int32, kResultOk, IPluginFactory, IPluginFactory2, IPluginFactory2Trait, IPluginFactoryTrait,
};

/// The most audio buses, per direction, the scanner will walk on one plugin.
///
/// `getBusCount` is a plugin-supplied `int32`, so it is an untrusted loop bound.
/// Real plugins declare a handful; one returning `int32::MAX` would otherwise
/// hold the worker inside a two-billion-iteration walk until its deadline killed
/// it, and would then report as broken rather than as unusual.
const MAX_SCANNED_AUDIO_BUSES: int32 = 64;

/// The category string VST3 gives an audio processing class.
const AUDIO_MODULE_CLASS: &str = "Audio Module Class";

/// What a VST3 bundle says about one of its plugin classes.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Vst3DescriptorMetadata {
    pub vendor: String,
    /// The class CID as 32 hex characters — VST3's move-survivable identity.
    pub class_id: String,
    pub version: String,
    pub sub_categories: Vec<String>,
    pub parameters: Option<Vec<ScannedParameterDescriptor>>,
    pub parameter_metadata_reason: Option<String>,
    pub capabilities: Option<ScannedInstanceCapabilities>,
}

impl Vst3DescriptorMetadata {
    /// The VST3 extractor's half of the seam: VST3 descriptor facts rendered in
    /// the scan's own vocabulary.
    pub fn into_scanned_descriptor(self) -> ScannedDescriptor {
        ScannedDescriptor {
            format: PluginFormat::Vst3.wire_name().to_string(),
            // VST3's bundle description carries no per-plugin display name the
            // extractor reads today, so the file stem stays the name — which is
            // also correct for a format whose bundles hold one audio class.
            name: None,
            category: category_from_vst3_sub_categories(&self.sub_categories),
            vendor: self.vendor,
            descriptor_id: self.class_id,
            version: self.version,
            parameters: self.parameters,
            parameter_metadata_reason: self.parameter_metadata_reason,
            capabilities: self.capabilities,
        }
    }
}

/// Map a VST3 sub-category list onto the category string the browser routes on.
///
/// Routing is the reason this exists: the plugin browser sends an instrument
/// down a different path from an effect, so reporting every plugin as an effect
/// puts instruments in the wrong place.
///
/// `Instrument` wins over a co-listed effect sub-category, matching the CLAP
/// extractor's rule and for the same reason: a plugin that both synthesises and
/// processes is an instrument as far as routing goes. VST3 declares no MIDI-only
/// category at all, so nothing maps to `note-effect` — a plugin that is one
/// declares itself an instrument, and that is the answer carried through rather
/// than a guess made here.
pub fn category_from_vst3_sub_categories(sub_categories: &[String]) -> String {
    let has = |needle: &str| {
        sub_categories
            .iter()
            .any(|category| category.eq_ignore_ascii_case(needle))
    };

    if has("Instrument") {
        return "instrument".to_string();
    }
    if has("Analyzer") {
        return "analyzer".to_string();
    }
    "effect".to_string()
}

/// Read a bundle's descriptor.
///
/// The bundle's own `moduleinfo.json` is preferred: it answers the same question
/// by reading a file, with the plugin's code never entering any process. Only a
/// bundle that ships no such file — or ships one that describes no plugin class —
/// is loaded to be asked.
///
/// # Safety
/// May load and call into a native VST3 module. Bounded scan worker only.
pub fn extract_vst3_metadata(path: &Path) -> Result<Vst3DescriptorMetadata, String> {
    if let Some(metadata) = read_metadata_from_module_info(path) {
        return Ok(metadata);
    }
    read_metadata_from_module(path)
}

/// The largest `moduleinfo.json` this scan will read.
///
/// The file is a list of class descriptions written by the SDK's generator; a
/// real one is kilobytes. The bound is here because the file is untrusted input
/// sitting inside a plugin bundle, and a scan that reads it whole would size the
/// scanner's memory from whatever a bundle chooses to put there. Generous enough
/// that no honest bundle meets it.
const MAX_MODULE_INFO_BYTES: u64 = 4 * 1024 * 1024;

fn read_metadata_from_module_info(bundle: &Path) -> Option<Vst3DescriptorMetadata> {
    crate::vst3_module::module_info_paths(bundle)
        .iter()
        .filter_map(|candidate| read_bounded(candidate).ok())
        .filter_map(|source| parse_module_info(&source).ok())
        .find_map(|info| first_audio_module_class(&info))
}

/// Read at most [`MAX_MODULE_INFO_BYTES`] of a file as UTF-8.
///
/// A file at the ceiling is truncated rather than refused, and the truncated text
/// then fails to parse — which is the same outcome as any other unreadable
/// description, and sends the caller to the module load path.
fn read_bounded(path: &Path) -> std::io::Result<String> {
    use std::io::Read;

    let mut source = String::new();
    std::fs::File::open(path)?
        .take(MAX_MODULE_INFO_BYTES)
        .read_to_string(&mut source)?;
    Ok(source)
}

fn first_audio_module_class(info: &ModuleInfo) -> Option<Vst3DescriptorMetadata> {
    let class = info.audio_module_classes().next()?;
    // Through the same conversion the load path uses. A side-car file that names
    // something which is not a class id describes no loadable plugin, and
    // publishing it anyway moves the failure from the scan to the moment a user
    // tries to open it.
    let class_id = normalized_class_id(&class.cid).ok()?;
    Some(Vst3DescriptorMetadata {
        vendor: fallback(&class.vendor, &info.factory_info.vendor),
        class_id,
        version: class.version.clone(),
        sub_categories: class.sub_categories.clone(),
        parameters: None,
        parameter_metadata_reason: None,
        capabilities: None,
    })
}

fn read_metadata_from_module(bundle: &Path) -> Result<Vst3DescriptorMetadata, String> {
    let module = Vst3Module::open(bundle)?;
    first_audio_module_class_of_factory(module.factory())
        .ok_or_else(|| "VST3 bundle declares no audio module class".to_string())
}

/// The first audio module class a factory lists, read through `getClassInfo2`.
///
/// `getClassInfo2` is what carries the vendor, version and sub-categories the
/// browser needs; `getClassInfo` carries none of them, so a factory too old to
/// answer it yields a class this scan cannot describe.
fn first_audio_module_class_of_factory(
    factory: &ComPtr<IPluginFactory>,
) -> Option<Vst3DescriptorMetadata> {
    let vendor = factory_info(factory)
        .map(|info| read_char8(&info.vendor))
        .unwrap_or_default();

    // `getClassInfo2` lives on `IPluginFactory2`. A factory too old to answer
    // that interface carries no vendor, version or sub-categories at all, so
    // there is nothing to describe the class with.
    let factory2 = factory.cast::<IPluginFactory2>()?;

    // SAFETY: the factory is live; each `info` is a valid out parameter.
    unsafe {
        let count = factory2.countClasses();
        for index in 0..count {
            let mut info: vst3::Steinberg::PClassInfo2 = std::mem::zeroed();
            if factory2.getClassInfo2(index, &mut info) != kResultOk {
                continue;
            }
            if read_char8(&info.category) != AUDIO_MODULE_CLASS {
                continue;
            }
            return Some(Vst3DescriptorMetadata {
                vendor: fallback(&read_char8(&info.vendor), &vendor),
                class_id: format_class_id(&info.cid),
                version: read_char8(&info.version),
                sub_categories: split_sub_categories(&read_char8(&info.subCategories)),
                parameters: None,
                parameter_metadata_reason: None,
                capabilities: None,
            });
        }
    }
    None
}

/// Create one live-but-unactivated VST3 instance, read its parameter contract
/// and its bus declaration, and destroy it. The app process never receives it.
///
/// # Safety
/// Calls third-party VST3 entry points and must only run in the bounded scan
/// worker.
pub fn extract_vst3_instance_metadata(path: &Path) -> Result<ScannedInstance, String> {
    let descriptor = extract_vst3_metadata(path)?;
    let instance = Vst3Instance::open(path, &descriptor.class_id)?;

    let parameters = instance
        .controller()
        .map(read_parameters)
        .unwrap_or_default()
        .into_iter()
        .map(scanned_parameter)
        .collect();

    Ok(ScannedInstance {
        parameters,
        capabilities: ScannedInstanceCapabilities {
            // Always `Some`: VST3 declares buses on `IComponent` itself, so a
            // plugin that was inspected at all answered this. There is no
            // optional extension to be absent, which is what the `None` case
            // records for CLAP.
            audio_channels: Some(audio_channel_counts(&instance)),
            // The editor is not embeddable by this host yet, so claiming one
            // would put a button in the browser that opens nothing.
            has_custom_ui: false,
        },
    })
}

/// A scanned parameter descriptor from a live parameter.
///
/// `is_modulatable` is false and `is_enum` is false because VST3 declares
/// neither: it has no per-note modulation flag, and `kIsList` marks a stepped
/// list rather than the enum contract this field names. `stepCount` is what VST3
/// uses to say a parameter is stepped, and it is not on the seam's parameter
/// type — so `is_stepped` reports the one thing that *is* knowable from here.
fn scanned_parameter(parameter: crate::params::PluginParameter) -> ScannedParameterDescriptor {
    ScannedParameterDescriptor {
        id: parameter.id,
        name: parameter.name,
        module: None,
        min_value: parameter.min_value,
        max_value: parameter.max_value,
        default_value: parameter.default_value,
        is_automatable: parameter.is_automatable,
        is_modulatable: false,
        is_stepped: false,
        is_enum: false,
    }
}

/// Total channels across a component's audio buses, per direction.
fn audio_channel_counts(instance: &Vst3Instance) -> ScannedAudioChannelCounts {
    ScannedAudioChannelCounts {
        inputs: bus_channel_total(instance, BusDirections_::kInput as int32),
        outputs: bus_channel_total(instance, BusDirections_::kOutput as int32),
    }
}

fn bus_channel_total(instance: &Vst3Instance, direction: int32) -> u32 {
    let component = instance.component();
    // SAFETY: the component is live and initialised; each `info` is a valid out
    // parameter.
    unsafe {
        let count = component
            .getBusCount(MediaTypes_::kAudio as int32, direction)
            .min(MAX_SCANNED_AUDIO_BUSES);
        (0..count)
            .filter_map(|index| {
                let mut info: BusInfo = std::mem::zeroed();
                if component.getBusInfo(MediaTypes_::kAudio as int32, direction, index, &mut info)
                    != kResultOk
                {
                    return None;
                }
                u32::try_from(info.channelCount).ok()
            })
            .sum()
    }
}

/// VST3 writes sub-categories as one pipe-separated string in `PClassInfo2`.
fn split_sub_categories(value: &str) -> Vec<String> {
    value
        .split('|')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn read_char8(value: &[std::ffi::c_char]) -> String {
    let bytes: Vec<u8> = value
        .iter()
        .take_while(|byte| **byte != 0)
        .map(|byte| *byte as u8)
        .collect();
    String::from_utf8_lossy(&bytes).trim().to_string()
}

/// The class's own answer when it has one, the factory's otherwise. A class that
/// names no vendor is described by the bundle that ships it.
fn fallback(preferred: &str, alternative: &str) -> String {
    if preferred.trim().is_empty() {
        return alternative.trim().to_string();
    }
    preferred.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vst3_module_info::{ModuleInfoClass, ModuleInfoFactory};

    fn categories(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    /// The browser routes instruments differently from effects, so a synth that
    /// reads as an effect lands in the wrong list.
    #[test]
    fn an_instrument_is_routed_as_one() {
        assert_eq!(
            category_from_vst3_sub_categories(&categories(&["Instrument", "Synth"])),
            "instrument"
        );
    }

    /// A plugin that both synthesises and processes is an instrument for routing.
    #[test]
    fn instrument_wins_over_a_co_listed_effect_category() {
        assert_eq!(
            category_from_vst3_sub_categories(&categories(&["Fx", "Instrument"])),
            "instrument"
        );
    }

    #[test]
    fn an_analyzer_is_routed_as_one() {
        assert_eq!(
            category_from_vst3_sub_categories(&categories(&["Fx", "Analyzer"])),
            "analyzer"
        );
    }

    /// Unrecognised or absent sub-categories fall back to the answer that was
    /// always given, so no existing routing changes.
    #[test]
    fn anything_else_stays_an_effect() {
        assert_eq!(
            category_from_vst3_sub_categories(&categories(&["Fx", "Reverb"])),
            "effect"
        );
        assert_eq!(category_from_vst3_sub_categories(&[]), "effect");
    }

    /// `PClassInfo2` packs sub-categories into one pipe-separated field, so a
    /// reader that treats it as a single category matches nothing.
    #[test]
    fn a_pipe_separated_field_splits_into_categories() {
        assert_eq!(
            split_sub_categories("Fx|Reverb"),
            vec!["Fx".to_string(), "Reverb".to_string()]
        );
        assert_eq!(split_sub_categories(""), Vec::<String>::new());
        assert_eq!(split_sub_categories("Fx||Delay").len(), 2);
    }

    /// The descriptor a `moduleinfo.json` yields must be the same shape the load
    /// path yields, or a bundle's category and identity would depend on whether
    /// it happened to ship the file.
    #[test]
    fn a_module_info_document_yields_a_complete_descriptor() {
        let document = r#"{
            "Factory Info": { "Vendor": "Bundle Vendor" },
            "Classes": [
                {
                    "CID": "1234567890abcdef1234567890abcdef",
                    "Category": "Audio Module Class",
                    "Name": "Big Reverb",
                    "Version": "2.1.0",
                    "Sub Categories": [ "Fx", "Reverb" ]
                }
            ]
        }"#;
        let info = parse_module_info(document).expect("a JSON5 document should parse");

        let metadata = first_audio_module_class(&info).expect("the document declares one class");

        assert_eq!(metadata.class_id, "1234567890ABCDEF1234567890ABCDEF");
        assert_eq!(metadata.vendor, "Bundle Vendor");
        assert_eq!(metadata.version, "2.1.0");
        assert_eq!(
            metadata.clone().into_scanned_descriptor().category,
            "effect"
        );
        assert_eq!(
            metadata.into_scanned_descriptor().format,
            PluginFormat::Vst3.wire_name()
        );
    }

    /// A class that names its own vendor keeps it; only one that names none is
    /// described by the bundle that ships it.
    #[test]
    fn a_class_vendor_outranks_the_factory_vendor() {
        let with_own = ModuleInfoClass {
            cid: "00".repeat(16),
            category: AUDIO_MODULE_CLASS.to_string(),
            name: "Plugin".to_string(),
            vendor: "Class Vendor".to_string(),
            version: String::new(),
            sub_categories: Vec::new(),
        };
        let info = ModuleInfo {
            factory_info: ModuleInfoFactory {
                vendor: "Bundle Vendor".to_string(),
            },
            classes: vec![
                ModuleInfoClass {
                    vendor: String::new(),
                    ..with_own.clone()
                },
                with_own.clone(),
            ],
        };

        assert_eq!(
            first_audio_module_class(&info)
                .expect("one class is declared")
                .vendor,
            "Bundle Vendor",
            "the first class names no vendor, so the bundle describes it"
        );

        let named_only = ModuleInfo {
            classes: vec![with_own],
            ..info
        };
        assert_eq!(
            first_audio_module_class(&named_only)
                .expect("one class is declared")
                .vendor,
            "Class Vendor"
        );
    }

    /// A scan publishes the identity a project stores, so the two spellings must
    /// be the same one.
    #[test]
    fn a_module_info_class_id_is_normalised_to_the_stored_spelling() {
        let lowercase = ModuleInfo {
            factory_info: ModuleInfoFactory::default(),
            classes: vec![ModuleInfoClass {
                cid: "  abcdef0123456789abcdef0123456789  ".to_string(),
                category: AUDIO_MODULE_CLASS.to_string(),
                name: "Plugin".to_string(),
                vendor: "Vendor".to_string(),
                version: "1.0".to_string(),
                sub_categories: Vec::new(),
            }],
        };

        assert_eq!(
            first_audio_module_class(&lowercase)
                .expect("one class is declared")
                .class_id,
            "ABCDEF0123456789ABCDEF0123456789"
        );
    }
}
