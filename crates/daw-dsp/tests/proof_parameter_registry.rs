//! Contract and actual PCM admission; all new checks were authored unexecuted.
use daw_dsp::proof::{parameter_registry::{self as registry, ParameterKind, ParameterRoute}, ProofInstance};
use serde_json::Value;

#[test]
fn proof_wire_projection_matches_every_canonical_field_and_stable_identity() {
    let wire: Value = serde_json::from_str(include_str!("../../../src/modules/AudioEngine/services/proofAppliedParameterContract.json")).unwrap();
    assert_eq!(wire["version"].as_u64(), Some(u64::from(registry::VERSION)));
    let rows = wire["parameters"].as_array().unwrap();
    assert!(!rows.is_empty());
    assert_eq!(rows.len(), registry::PARAMETERS.len());
    let mut names = std::collections::BTreeSet::new();
    let mut ids = std::collections::BTreeSet::new();
    for (row, parameter) in rows.iter().zip(registry::PARAMETERS) {
        assert!(names.insert(parameter.name));
        assert!(ids.insert(parameter.id));
        assert_eq!(registry::by_name(parameter.name), Some(parameter));
        assert_eq!(row["id"].as_u64(), Some(u64::from(parameter.id)));
        assert_eq!(row["name"].as_str(), Some(parameter.name));
        assert_eq!(row["route"].as_str(), Some(parameter.route.as_str()));
        assert_eq!(row["kind"].as_str(), Some(parameter.kind.as_str()));
        for (field, expected) in [("minimum",parameter.minimum),("maximum",parameter.maximum),("default",parameter.default),("liveMinimum",parameter.live_minimum),("liveMaximum",parameter.live_maximum)] {
            assert_eq!(row[field].as_f64().unwrap() as f32, expected, "{} {field}",parameter.name);
        }
        assert_eq!(row["live"].as_bool(),Some(parameter.live));
        assert_eq!(row["persisted"].as_bool(),Some(parameter.persisted));
        assert_eq!(row["clamp"].as_bool(),Some(parameter.clamp));
    }
    // These are assigned identities, not positions inferred at runtime.
    for (name,id) in [("bypass",0),("ab_bypass",1),("input_gain",2),("output_gain",3),("eq_linear_phase",16)] {
        assert_eq!(registry::by_name(name).unwrap().id,id);
    }
}

#[test]
fn proof_registry_covers_the_existing_setter_families_without_prefix_aliases() {
    let mut expected: Vec<String> = ["bypass","ab_bypass","input_gain","output_gain","eq_bypass","eq_output_gain","eq_linear_phase","dyneq_bypass","match_enabled","match_amount","match_smoothing","match_max_correction","dyn_bypass","img_bypass","img_auto_mono_bass","img_mono_bass_freq","exc_bypass","lim_bypass","lim_ceiling","lim_release","lim_lookahead","dither_mode","dither_bits"].into_iter().map(str::to_owned).collect();
    for band in 0..8 { for field in ["freq","gain","q","type","channel","enabled"] { expected.push(format!("eq_band{band}_{field}")); } }
    for band in 0..4 {
        for field in ["freq","q","threshold","ratio","attack","release","range","mode","enabled"] { expected.push(format!("dyneq_band{band}_{field}")); }
        for field in ["threshold","ratio","attack","release","knee","makeup","auto_makeup","bypass","solo"] { expected.push(format!("dyn_band{band}_{field}")); }
        for field in ["type","drive","blend","enabled"] { expected.push(format!("exc_band{band}_{field}")); }
        expected.push(format!("img_width{band}"));
    }
    for band in 0..3 { expected.push(format!("dyn_xover{band}")); expected.push(format!("img_xover{band}")); }
    for slot in 0..5 { expected.push(format!("chain_order_{slot}")); }
    expected.sort();
    let mut actual: Vec<_> = registry::PARAMETERS.iter().map(|p|p.name.to_owned()).collect();actual.sort();
    assert_eq!(actual,expected);
    for name in ["eq_band0Xfreq","dyn_xover0_extra","img_width1_extra","chain_order_00","target_lufs","lim_threshold"] { assert!(registry::by_name(name).is_none(),"{name}"); }
    for parameter in registry::PARAMETERS { if parameter.kind != ParameterKind::Continuous { assert!(parameter.normalize(0.25).is_none(),"{}",parameter.name); } }
    assert!(registry::PARAMETERS.iter().any(|p|p.route==ParameterRoute::MatchEq));
}

#[test]
fn existing_live_namespace_keeps_its_assigned_order() {
    // Pre-registry ProofRuntimeControl.ts at 41c1bb6c: these ordinal names
    // participate in the existing ready handshake and cannot be reordered.
    let mut expected: Vec<String> = ["bypass","ab_bypass","input_gain","output_gain","eq_bypass","dyn_bypass","img_bypass","img_auto_mono_bass","img_mono_bass_freq","exc_bypass","lim_bypass","lim_ceiling","lim_release","lim_lookahead","dither_mode","dither_bits","eq_linear_phase"].into_iter().map(str::to_owned).collect();
    for band in 0..8 { for field in ["freq","gain","q","type","channel","enabled"] { expected.push(format!("eq_band{band}_{field}")); } }
    for band in 0..3 { expected.push(format!("dyn_xover{band}")); }
    for band in 0..4 {
        for field in ["threshold","ratio","attack","release","knee","makeup","auto_makeup","bypass"] { expected.push(format!("dyn_band{band}_{field}")); }
        expected.push(format!("img_width{band}"));
        for field in ["type","drive","blend","enabled"] { expected.push(format!("exc_band{band}_{field}")); }
    }
    let live:Vec<_> = registry::PARAMETERS.iter().filter(|p|p.live).collect();
    assert_eq!(live.iter().map(|p|p.name).collect::<Vec<_>>(),expected.iter().map(String::as_str).collect::<Vec<_>>());
    for (ordinal, parameter) in live.iter().enumerate() {assert_eq!(usize::from(parameter.id),ordinal);}
}

fn render(trim: f32, refused: bool) -> Vec<f32> {
    let mut instance=ProofInstance::new(48_000.0);
    for stage in ["eq_bypass","dyneq_bypass","dyn_bypass","img_bypass","exc_bypass","lim_bypass"] {instance.set_param(stage,1.0);}
    instance.set_param("input_gain",trim);
    if refused { for (name,value) in [("input_gain",f32::NAN),("eq_band0Xfreq",f32::INFINITY),("dither_mode",0.25),("unknown",1.0)] {instance.set_param(name,value);} }
    let mut result=Vec::new();
    for _ in 0..8 { unsafe { for frame in 0..128 { *instance.get_input_left_ptr().add(frame)=0.1;*instance.get_input_right_ptr().add(frame)=0.07; } } let pointer=instance.process(128);unsafe{result.extend_from_slice(std::slice::from_raw_parts(pointer,128));} }
    result
}
#[test]
fn proof_instance_refusal_preserves_nondefault_pcm() {
    let nondefault=render(-6.0,false);
    assert!(nondefault.iter().any(|s|*s!=0.0));
    assert_eq!(nondefault,render(-6.0,true));
    assert_ne!(nondefault,render(3.0,false));
}
