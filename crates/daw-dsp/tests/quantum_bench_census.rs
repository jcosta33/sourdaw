//! Native and browser-WASM device benchmark coverage.
//!
//! # Why this test exists
//!
//! `benches/quantum.rs` opens by claiming it covers every native device wrapper
//! and then lists them by hand. The list went
//! stale: `crates/daw-dsp/src/crust/` shipped a `CrustInstance` with a
//! `process` export, and the header went on asserting that Crust "[has] no Rust
//! engine at all" while the table quietly measured one device fewer than it
//! claimed. Nothing failed, because nothing compared the list to the crate.
//!
//! That is ADR 0015 rule 2 exactly — a census whose population and whose
//! expectation come from the same place tests nothing. So this test derives the
//! population from the crate source and the verdict from the bench source: two
//! independently-written files, per rule 3. Adding a device without a bench row
//! now reds here.
//!
//! # What counts as a device
//!
//! A directory under `src/` whose `mod.rs` declares a `#[wasm_bindgen]`
//! `pub struct <Name>Instance` **and** a `pub fn process(`. That is the shape
//! every worklet drives, and it is the shape the bench's budget claim is about.
//! The separate browser-WASM assertion pins Grand Boule's constructor, recipe,
//! Worker total, and ring-consumer measurement.
//!
//! # What counts as covered
//!
//! The bench source must contain `<Name>Instance::new`. Not a row id, and not a
//! label — those are strings a stale row keeps producing after the device it
//! names has moved on. Constructing the type is the one thing a row cannot fake
//! and still be a measurement of that device.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Devices deliberately absent from the bench, with the reason each is absent.
///
/// Empty today, and kept rather than deleted because the alternative to a
/// reason-bearing exemption table is a silently shrinking census — which is the
/// failure this file exists to stop. Adding an entry costs a written reason;
/// that is the point of the cost.
///
/// Note what is *not* here: ProofChamber and Scoring live in sibling crates and
/// so never enter this population, and Yeast and CvGate have no Rust engine at
/// all. Neither needs an exemption because neither is a member.
const EXEMPT: &[(&str, &str)] = &[];

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Whether the bench actually constructs this device.
///
/// Extracted so the broken-fixture tests below drive **this** function rather
/// than re-implementing the check inside the test — a fixture test that
/// reimplements the predicate proves the reimplementation, not the guard.
fn device_is_covered(bench_source: &str, type_name: &str) -> bool {
    executable_function_bodies(bench_source).iter().any(|body| {
        let marker = format!("{type_name}::new");
        body.find(&marker)
            .is_some_and(|index| !body[..index].contains("return"))
    })
}

fn source_without_non_code(source: &str) -> String {
    let mut output = String::with_capacity(source.len());
    let mut chars = source.chars().peekable();
    let mut mode = 0_u8;
    let mut escaped = false;
    while let Some(ch) = chars.next() {
        if mode == 1 {
            if ch == '\n' {
                mode = 0;
                output.push('\n');
            } else {
                output.push(' ');
            }
        } else if mode == 2 {
            if ch == '*' && chars.peek() == Some(&'/') {
                output.push(' ');
                output.push(' ');
                chars.next();
                mode = 0;
            } else {
                output.push(if ch == '\n' { '\n' } else { ' ' });
            }
        } else if mode == 3 || mode == 4 {
            output.push(if ch == '\n' { '\n' } else { ' ' });
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if (mode == 3 && ch == '"') || (mode == 4 && ch == '\'') {
                mode = 0;
            }
        } else if ch == '/' && chars.peek() == Some(&'/') {
            output.push(' ');
            output.push(' ');
            chars.next();
            mode = 1;
        } else if ch == '/' && chars.peek() == Some(&'*') {
            output.push(' ');
            output.push(' ');
            chars.next();
            mode = 2;
        } else if ch == '"' {
            output.push(' ');
            mode = 3;
        } else if ch == '\'' {
            output.push(' ');
            mode = 4;
        } else {
            output.push(ch);
        }
    }
    output
}

fn executable_function_bodies(source: &str) -> Vec<String> {
    let source = source_without_non_code(source);
    let bytes = source.as_bytes();
    let mut bodies = Vec::new();
    let mut cursor = 0;
    while let Some(offset) = source[cursor..].find("fn ") {
        let start = cursor + offset;
        let Some(open_offset) = source[start..].find('{') else {
            break;
        };
        let open = start + open_offset;
        let mut depth = 0_i32;
        for index in open..bytes.len() {
            match bytes[index] {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        bodies.push(source[open + 1..index].to_string());
                        cursor = index + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        if cursor <= open {
            break;
        }
    }
    bodies
}

fn named_function_body(source: &str, name: &str) -> Option<String> {
    let source = source_without_non_code(source);
    let declaration = format!("fn {name}");
    let start = source.find(&declaration)?;
    let open = start + source[start..].find('{')?;
    let mut depth = 0_i32;
    for (offset, byte) in source.as_bytes()[open..].iter().enumerate() {
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(source[open + 1..open + offset].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

/// A census marker must be executable source, never a stale prose reference.
/// The recipes contain both line and block comments, so strip both before
/// checking construction evidence.
fn source_without_comments(source: &str) -> String {
    let mut result = String::with_capacity(source.len());
    let mut characters = source.chars().peekable();
    let mut in_block_comment = false;
    let mut in_line_comment = false;

    while let Some(character) = characters.next() {
        if in_line_comment {
            if character == '\n' {
                in_line_comment = false;
                result.push(character);
            }
            continue;
        }
        if in_block_comment {
            if character == '*' && characters.peek() == Some(&'/') {
                characters.next();
                in_block_comment = false;
            }
            continue;
        }
        if character == '/' && characters.peek() == Some(&'/') {
            characters.next();
            in_line_comment = true;
        } else if character == '/' && characters.peek() == Some(&'*') {
            characters.next();
            in_block_comment = true;
        } else {
            result.push(character);
        }
    }
    result
}

/// A device found in the crate: its module directory name and its type name.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Device {
    module: String,
    type_name: String,
}

/// Pull `<Name>Instance` out of a `mod.rs` that declares one with a wasm
/// binding and a render export.
///
/// Kept as a free function over a `&str` so the broken-fixture tests at the
/// bottom can drive it without writing files.
fn device_type_in_module_source(source: &str) -> Option<String> {
    let source = source_without_non_code(source);
    if !source.contains("#[wasm_bindgen]") {
        return None;
    }
    if !source.contains("pub fn process(") {
        return None;
    }
    for line in source.lines() {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix("pub struct ") else {
            continue;
        };
        let name = rest
            .trim_end_matches(&[' ', '{'][..])
            .split_whitespace()
            .next()
            .unwrap_or_default();
        if name.ends_with("Instance") && !name.is_empty() {
            return Some(name.to_string());
        }
    }
    None
}

fn devices_in_crate(src: &Path) -> Vec<Device> {
    let mut found = Vec::new();
    let entries = std::fs::read_dir(src).expect("crates/daw-dsp/src must be readable");
    for entry in entries {
        let entry = entry.expect("directory entry must be readable");
        if !entry
            .file_type()
            .expect("file type must be readable")
            .is_dir()
        {
            continue;
        }
        let module_path = entry.path().join("mod.rs");
        if !module_path.exists() {
            continue;
        }
        let source = std::fs::read_to_string(&module_path)
            .unwrap_or_else(|error| panic!("{} must be readable: {error}", module_path.display()));
        if let Some(type_name) = device_type_in_module_source(&source) {
            found.push(Device {
                module: entry
                    .file_name()
                    .to_str()
                    .expect("module directory name must be UTF-8")
                    .to_string(),
                type_name,
            });
        }
    }
    found.sort();
    found
}

/// The census fails if it finds nobody. A population of zero satisfies every
/// per-member assertion below and would report a clean run from an extraction
/// that had gone blind — ADR 0015 rule 4, the presence pin for an absence
/// claim.
#[test]
fn the_crate_scan_finds_a_plausible_population() {
    let devices = devices_in_crate(&crate_root().join("src"));
    let modules: BTreeSet<&str> = devices.iter().map(|d| d.module.as_str()).collect();

    assert!(
        devices.len() >= 10,
        "the device scan found {} devices, which is fewer than this crate is known to ship. \
         The extraction has probably gone blind rather than the crate having shrunk: {devices:?}",
        devices.len()
    );
    // Three named anchors so a rename that breaks the scan cannot pass on count
    // alone. Crust is here on purpose: it is the device whose absence from the
    // bench motivated this file.
    for anchor in ["crust", "fermenter", "levain"] {
        assert!(
            modules.contains(anchor),
            "the device scan did not find `{anchor}`, so the extraction is broken. Found: {modules:?}"
        );
    }
}

#[test]
fn every_native_device_is_constructed_by_the_native_cost_bench() {
    let root = crate_root();
    let devices = devices_in_crate(&root.join("src"));
    let bench = std::fs::read_to_string(root.join("benches/quantum.rs"))
        .expect("benches/quantum.rs must be readable");

    let mut missing = Vec::new();
    for device in &devices {
        if let Some((_, reason)) = EXEMPT.iter().find(|(name, _)| *name == device.module) {
            assert!(
                !reason.trim().is_empty(),
                "exemption for `{}` carries no reason",
                device.module
            );
            continue;
        }
        if !device_is_covered(&bench, &device.type_name) {
            missing.push(format!(
                "{} (expected `{}::new` in the bench)",
                device.module, device.type_name
            ));
        }
    }

    assert!(
        missing.is_empty(),
        "these native devices have an instance render wrapper and no row in \
         benches/quantum.rs, so the cost table measures fewer devices than its header \
         claims. Add a row, or add a reason-bearing entry to EXEMPT: {missing:?}"
    );
}

#[test]
fn released_grand_boule_is_in_the_browser_wasm_bench() {
    let root = crate_root();
    let processor = std::fs::read_to_string(root.join("benches/wasm/quantumCostProcessor.js"))
        .expect("browser WASM processor source must be readable");
    let recipes = std::fs::read_to_string(root.join("benches/wasm/deviceRecipes.js"))
        .expect("browser WASM recipes must be readable");
    let runner = std::fs::read_to_string(root.join("benches/wasm/run.mjs"))
        .expect("browser WASM runner must be readable");
    let executable_recipes = source_without_non_code(&recipes);
    let processor = source_without_comments(&processor);
    let recipes = source_without_comments(&recipes);
    let runner = source_without_comments(&runner);
    assert!(
        processor.contains("GrandBouleInstance"),
        "the browser WASM processor must import GrandBouleInstance"
    );
    for required in [
        "wanted('grand_boule')",
        "new dsp.GrandBouleInstance(SAMPLE_RATE, 64)",
    ] {
        assert!(
            recipes.contains(required),
            "the browser WASM recipe/census is missing Grand Boule marker `{required}`"
        );
    }
    for required in [
        "activeVoices: () => instance.active_voices()",
        "expectSounding: struck",
    ] {
        assert!(
            executable_recipes.contains(required),
            "the browser Grand Boule measurement lacks executable exact-occupancy proof `{required}`"
        );
    }
    for required in ["const REFERENCE_PROJECT_WORKER = [['grand_boule', 1]]"] {
        assert!(
            runner.contains(required),
            "the browser WASM runner is missing Grand Boule Worker marker `{required}`"
        );
    }
    assert!(
        processor.contains("const produced = device.render()"),
        "the browser WASM processor must render the selected Worker recipe in its timed path"
    );

    for required in [
        "publishGrandBouleConsumerClock",
        "GRAND_BOULE_READ_HEAD_IDX",
        "GRAND_BOULE_SLEEP_HEAD_IDX",
        "GRAND_BOULE_RENDER_REQUEST_IDX",
        "Atomics.notify",
    ] {
        assert!(
            recipes.contains(required),
            "the ring-consumer benchmark must reproduce production marker `{required}`"
        );
    }
    assert!(
        processor.contains("publishGrandBouleConsumerClock"),
        "the browser benchmark processor must inject the production consumer-clock publisher into the recipe"
    );
}

#[test]
fn grand_boule_remains_in_the_native_cost_bench() {
    let bench = std::fs::read_to_string(crate_root().join("benches/quantum.rs"))
        .expect("native cost bench must be readable");
    assert!(device_is_covered(&bench, "GrandBouleInstance"));
    let row = named_function_body(&bench, "row_grand_boule")
        .expect("Grand Boule measured row must exist");
    for required in ["active_voices", "assert_eq!", "GRAND_BOULE_POOL"] {
        assert!(
            row.contains(required),
            "Grand Boule measured row lacks executable {required}"
        );
    }
}

/// The deliberately broken fixtures ADR 0015 rule 2 (iv) requires.
///
/// Without these, every assertion above is satisfied by an extractor that
/// returns `None` for everything, and the census would report a clean crate
/// forever.
#[cfg(test)]
mod the_extractor_can_go_red {
    use super::{device_is_covered, device_type_in_module_source};

    const WASM_DEVICE: &str = r#"
        use wasm_bindgen::prelude::*;
        #[wasm_bindgen]
        pub struct SourdoughInstance {
            engine: u8,
        }
        #[wasm_bindgen]
        impl SourdoughInstance {
            pub fn process(&mut self, block_size: u32) -> *const f32 {
                std::ptr::null()
            }
        }
    "#;

    #[test]
    fn a_wasm_device_is_recognised() {
        assert_eq!(
            device_type_in_module_source(WASM_DEVICE).as_deref(),
            Some("SourdoughInstance"),
            "the extractor must find a device that has both a wasm binding and a render export"
        );
    }

    #[test]
    fn a_module_without_a_wasm_binding_is_not_a_device() {
        let source = WASM_DEVICE.replace("#[wasm_bindgen]", "");
        assert_eq!(
            device_type_in_module_source(&source),
            None,
            "a module with no wasm binding never reaches a worklet and is not on the audio thread"
        );
    }

    #[test]
    fn a_module_without_a_render_export_is_not_a_device() {
        let source = WASM_DEVICE.replace("pub fn process(", "pub fn describe(");
        assert_eq!(
            device_type_in_module_source(&source),
            None,
            "a module with no render export costs nothing per quantum"
        );
    }

    /// The case that actually happened: a real device whose row is missing.
    ///
    /// Drives `device_is_covered`, the same predicate the live census uses, in
    /// both directions against one fixture pair. Both halves are needed — the
    /// negative alone is satisfied by a predicate hardwired to `false`, and the
    /// positive alone by one hardwired to `true`.
    #[test]
    fn coverage_is_decided_by_constructing_the_device() {
        let device = device_type_in_module_source(WASM_DEVICE).expect("fixture is a device");

        // Crust's exact shape: the bench names other devices and not this one.
        let bench_without_it =
            "fn row() { let mut i = daw_dsp::gluten::GlutenInstance::new(SAMPLE_RATE); }";
        assert!(
            !device_is_covered(bench_without_it, &device),
            "a bench that never constructs the device must not count as covering it"
        );

        let bench_with_it =
            format!("fn row() {{ let mut i = daw_dsp::sourdough::{device}::new(SAMPLE_RATE); }}");
        assert!(
            device_is_covered(&bench_with_it, &device),
            "a bench that does construct the device must count as covering it, or the census \
             reports every device missing and is useless in the other direction"
        );
    }

    /// A row that merely *mentions* the device is not a measurement of it.
    ///
    /// The obvious cheaper predicate — does the bench source contain the device
    /// name — passes on a label, a comment, or a stale doc reference. Crust was
    /// named in the bench header the whole time it had no row.
    #[test]
    fn naming_the_device_without_constructing_it_is_not_coverage() {
        let device = device_type_in_module_source(WASM_DEVICE).expect("fixture is a device");
        let only_mentioned = format!("//! {device} is absent because it has no Rust engine.");
        assert!(
            !device_is_covered(&only_mentioned, &device),
            "prose naming the device must not satisfy the census — that is the exact way the \
             Crust gap survived"
        );
    }

    #[test]
    fn comment_only_constructor_markers_are_not_coverage() {
        assert!(!device_is_covered(
            "// SourdoughInstance::new(SAMPLE_RATE)\n/* SourdoughInstance::new(SAMPLE_RATE) */",
            "SourdoughInstance"
        ));
    }

    #[test]
    fn string_and_unreachable_constructor_markers_are_not_coverage() {
        assert!(!device_is_covered(
            r#"fn decoy() { let marker = "SourdoughInstance::new(SAMPLE_RATE)"; return; SourdoughInstance::new(SAMPLE_RATE); }"#,
            "SourdoughInstance"
        ));
    }
}
