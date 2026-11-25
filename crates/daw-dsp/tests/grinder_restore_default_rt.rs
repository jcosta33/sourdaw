#![cfg(debug_assertions)]

use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use daw_dsp::grinder::GrinderInstance;

#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

#[test]
fn restoring_configuration_on_the_render_instance_does_not_allocate() {
    let mut grinder = GrinderInstance::new(48_000.0);
    for name in [
        "gateAttack",
        "gateRelease",
        "transformerDrive",
        "transformerHysteresis",
        "transformerLfSaturation",
        "couplingCapCharge",
    ] {
        grinder.set_param(name, 0.7);
    }
    assert_no_alloc(|| {
        for name in [
            "gateAttack",
            "gateRelease",
            "transformerDrive",
            "transformerHysteresis",
            "transformerLfSaturation",
            "couplingCapCharge",
        ] {
            assert!(grinder.restore_parameter_default(name));
        }
        assert!(!grinder.restore_parameter_default("gain"));
    });
}
