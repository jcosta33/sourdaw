//! A `style` write that precedes a `topology` write must not undo the topology.
//!
//! The engine's `style` write is a macro that also selects a topology
//! (`load_style`: Glue and Pump select the VCA, Punch the FET, Smooth the
//! Opto), so every Gluten record reaches the engine `style` first, then
//! `topology` (`loadGlutenPatchWithAudio.ts`, `orderDeviceParametersForReplay`
//! via `DEVICE_PATCH_PRECEDENCE.gluten`, and `GLUTEN_MACRO_KEYS` in the native
//! scheduler). The factory "Diode Master" preset stores `topology: 'diode'`
//! with `style: 'glue'` (`glutenPresets.ts` `inferStyle`), and a user who
//! clicks a topology button writes only `topology`, leaving `style` as it was.
//! The panel shows the stored topology, so the engine must run it.

use daw_dsp::gluten::GlutenInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const BLOCKS: usize = 300;

const TOPOLOGY_VCA: f32 = 0.0;
const TOPOLOGY_DIODE: f32 = 3.0;
const STYLE_GLUE: f32 = 0.0;

fn stimulus(index: usize) -> (f32, f32) {
    let t = index as f32 / SAMPLE_RATE;
    let loud = (index / (SAMPLE_RATE as usize / 1000 * 60)) % 2 == 0;
    let amp = if loud { 0.9 } else { 0.05 };
    (
        amp * (std::f32::consts::TAU * 220.0 * t).sin(),
        amp * (std::f32::consts::TAU * 330.0 * t).sin(),
    )
}

fn render(configure: impl Fn(&mut GlutenInstance)) -> Vec<f32> {
    let mut instance = GlutenInstance::new(SAMPLE_RATE);
    configure(&mut instance);
    let mut captured = Vec::with_capacity(BLOCKS * BLOCK * 2);
    for block in 0..BLOCKS {
        let base = block * BLOCK;
        let left_ptr = instance.get_input_left_ptr();
        let right_ptr = instance.get_input_right_ptr();
        for n in 0..BLOCK {
            let (left, right) = stimulus(base + n);
            unsafe {
                *left_ptr.add(n) = left;
                *right_ptr.add(n) = right;
            }
        }
        let out_left = instance.process(BLOCK as u32);
        let out_right = instance.get_right_ptr();
        for n in 0..BLOCK {
            captured.push(unsafe { *out_left.add(n) });
            captured.push(unsafe { *out_right.add(n) });
        }
    }
    captured
}

fn max_delta(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right.iter())
        .map(|(a, b)| (a - b).abs())
        .fold(0.0_f32, f32::max)
}

/// The "Diode Master" factory preset, in the exact order
/// `loadGlutenPatchWithAudio` pushes it, with engine names from
/// `GlutenDspParamNames.ts`. `style` is `None` to omit the write.
fn diode_master(topology: f32, style: Option<f32>) -> impl Fn(&mut GlutenInstance) {
    move |i: &mut GlutenInstance| {
        if let Some(style) = style {
            i.set_param("style", style);
        }
        i.set_param("topology", topology);
        i.set_param("amount", 50.0);
        i.set_param("threshold", -16.0);
        i.set_param("ratio", 2.0);
        i.set_param("attack", 10.0);
        i.set_param("release", 300.0);
        i.set_param("knee", 6.0);
        i.set_param("makeup", 0.0);
        i.set_param("mix", 1.0);
        i.set_param("auto_makeup", 0.0);
        i.set_param("auto_release", 0.0);
        i.set_param("range", 15.0);
        i.set_param("sc_hpf_freq", 80.0);
        i.set_param("sc_hpf_enabled", 1.0);
        i.set_param("thrust", 0.0);
        i.set_param("detection", 0.0);
        i.set_param("stereo_mode", 0.0);
        i.set_param("stereo_link", 1.0);
        i.set_param("oversampling", 2.0);
        i.set_param("lookahead", 0.0);
        i.set_param("sc_lpf_freq", 20_000.0);
        i.set_param("sc_lpf_enabled", 0.0);
        i.set_param("sc_eq_freq", 1000.0);
        i.set_param("sc_eq_gain", 0.0);
        i.set_param("sc_eq_q", 1.0);
        i.set_param("sc_eq_enabled", 0.0);
        i.set_param("delta_listen", 0.0);
        i.set_param("gain_match_bypass", 0.0);
        i.set_param("ext_sidechain", 0.0);
        i.set_param("input_gain", 0.0);
        i.set_param("output_gain", 0.0);
        i.set_param("xfmr_drive", 1.2);
        i.set_param("all_buttons", 0.0);
        i.set_param("limit_mode", 0.0);
        i.set_param("recovery", 3.0);
        i.set_param("vca_type", 1.0);
        i.set_param("vca_character", 0.003);
        i.set_param("feed_forward", 0.0);
        i.set_param("jfet_k3", 0.15);
        i.set_param("xfmr_k2", 0.0);
        i.set_param("blend_topology", 1.0);
        i.set_param("blend_amount", 0.0);
    }
}

#[test]
fn diode_differs_audibly_from_vca_control() {
    // Control: the two topologies are distinguishable with this patch, so a
    // null in the test below is a real statement about topology selection.
    let diode = render(diode_master(TOPOLOGY_DIODE, None));
    let vca = render(diode_master(TOPOLOGY_VCA, None));
    let delta = max_delta(&diode, &vca);
    assert!(
        delta > 1e-2,
        "diode and VCA must render differently for this patch, max delta {delta:e}"
    );
}

#[test]
fn diode_master_preset_runs_the_diode_topology_it_stores() {
    let stored_diode_without_style = render(diode_master(TOPOLOGY_DIODE, None));
    let preset_as_pushed = render(diode_master(TOPOLOGY_DIODE, Some(STYLE_GLUE)));
    let vca = render(diode_master(TOPOLOGY_VCA, Some(STYLE_GLUE)));

    let delta_to_diode = max_delta(&preset_as_pushed, &stored_diode_without_style);
    let delta_to_vca = max_delta(&preset_as_pushed, &vca);
    assert!(
        delta_to_diode < 1e-6,
        "style=glue followed by topology=diode must still run the diode stage; \
         max delta to diode render {delta_to_diode:e}, max delta to VCA render {delta_to_vca:e}"
    );
}
