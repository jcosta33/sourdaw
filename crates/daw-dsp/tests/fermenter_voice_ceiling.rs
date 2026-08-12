use assert_no_alloc::assert_no_alloc;
use daw_dsp::fermenter::FermenterInstance;

const SAMPLE_RATE: f32 = 48_000.0;

#[test]
fn constructor_voice_ceiling_bounds_single_and_stacked_layers() {
    let mut single_layer = FermenterInstance::new(SAMPLE_RATE, 2);
    for note in 60..63 {
        single_layer.note_on(note, 100);
    }
    assert_eq!(single_layer.active_voices(), 2);

    let mut stacked_layers = FermenterInstance::new(SAMPLE_RATE, 4);
    stacked_layers.set_param("num_layers", 2.0);
    for note in 60..63 {
        stacked_layers.note_on(note, 100);
    }
    assert_eq!(stacked_layers.active_voices(), 4);
}

#[test]
fn production_voice_ceiling_is_reachable_and_enforced() {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 32);
    for note in 24..56 {
        instance.note_on(note, 100);
    }
    assert_eq!(instance.active_voices(), 32);

    instance.note_on(56, 100);
    assert_eq!(instance.active_voices(), 32);
}

#[test]
fn constructor_clamps_voice_ceiling_to_supported_bounds() {
    let mut zero = FermenterInstance::new(SAMPLE_RATE, 0);
    zero.note_on(60, 100);
    zero.note_on(61, 100);
    assert_eq!(zero.active_voices(), 1);

    let mut oversized = FermenterInstance::new(SAMPLE_RATE, u32::MAX);
    for note in 0..65 {
        oversized.note_on(note, 100);
    }
    assert_eq!(oversized.active_voices(), 64);
}

#[test]
fn enforcing_the_global_ceiling_does_not_allocate() {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 4);
    instance.set_param("num_layers", 2.0);
    instance.note_on(60, 100);
    instance.note_on(61, 100);

    assert_no_alloc(|| instance.note_on(62, 100));
    assert_eq!(instance.active_voices(), 4);
}
