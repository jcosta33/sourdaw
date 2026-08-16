//! IPC parity fixtures: what a command answers today, over the real Tauri IPC.
//!
//! The Electron shell has to reproduce these answers byte for byte, because the
//! renderer is the same build in both shells and it parses whatever the backend
//! sends. A field renamed, a `Result` flattened, an error turned from a string
//! into an object — none of that fails to compile, and all of it breaks the app
//! at runtime. So the answers are recorded here, from the Tauri implementation,
//! before anything is ported.
//!
//! ## Why the responses are produced this way
//!
//! Driving the shipped app was not an option: the Tauri webview on macOS has no
//! automation surface (`tauri-driver` is Windows/Linux only), so there is no way
//! to invoke a command in the running product and read what came back.
//!
//! The next-closest boundary is this one. `tauri::test::get_ipc_response` runs
//! the command through the same invoke pipeline the webview uses — argument
//! deserialization, state injection, handler dispatch, response serialization —
//! and hands back the `InvokeResponseBody` that would have gone over the wire.
//! It is the real serializer on the real command, not a hand-written mirror.
//!
//! ## Why the command sources are included by `#[path]`
//!
//! `src-tauri/src/lib.rs` declares `mod commands;` privately, so no integration
//! test can name a command. Rather than widen the crate's public surface for a
//! test, the test binary compiles the real command sources into itself. The
//! modules below are the actual product files: a change to the wire shape lands
//! in this test with no mirror to update, which is the whole point.
//!
//! That inclusion is also the limit on which commands can be covered. A command
//! module that reaches into `crate::state` (plugins, plugin GUI, crumbs, engine
//! diagnostics) cannot compile standalone here, and a command whose answer is a
//! reading of the host (`list_midi_inputs` enumerates whatever MIDI ports this
//! machine has attached) has no fixture worth committing — it would record the
//! machine, not the contract. Both classes are deliberately absent.
//!
//! ## Updating
//!
//! `SOURDAW_UPDATE_IPC_FIXTURES=1` rewrites the files under
//! `scripts/ipcFixtures/`. Without it the test compares, so a wire-shape change
//! made without intent fails here.

// The included modules carry the whole command surface, most of which no case
// below invokes.
#![allow(dead_code)]

#[path = "../src/commands"]
mod commands {
    pub mod binary_ipc;
    pub mod filesystem;

    pub mod collab;
    pub mod link;
    pub mod tuning;
}

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

/// A 12-tone equal temperament scale in cents, the shape almost every real
/// `.scl` file has.
const TWELVE_TONE_SCL: &str = "! 12tet.scl\n\
!\n\
12-tone equal temperament\n\
 12\n\
!\n\
 100.000\n\
 200.000\n\
 300.000\n\
 400.000\n\
 500.000\n\
 600.000\n\
 700.000\n\
 800.000\n\
 900.000\n\
 1000.000\n\
 1100.000\n\
 2/1\n";

/// A one-tone octave scale. Every table entry is the root times an integral
/// power of two, so this fixture is bit-exact on any machine — the 12-tone one
/// above goes through `powf` per entry and is only exact per host libm.
const OCTAVE_SCL: &str = "! octave.scl\n\
!\n\
Single octave period\n\
 1\n\
!\n\
 2/1\n";

struct Case {
    command: &'static str,
    name: &'static str,
    args: Value,
}

fn cases() -> Vec<Case> {
    vec![
        Case {
            command: "parse_scl",
            name: "twelve_tone_equal_temperament",
            args: json!({ "content": TWELVE_TONE_SCL, "rootNote": 69, "rootFreq": 440.0 }),
        },
        Case {
            command: "parse_scl",
            name: "octave_ratio_scale",
            args: json!({ "content": OCTAVE_SCL, "rootNote": 60, "rootFreq": 256.0 }),
        },
        // The error path is half the contract: the renderer shows this string.
        Case {
            command: "parse_scl",
            name: "malformed_content",
            args: json!({ "content": "! broken.scl\nBroken\n 1\n not-a-tone\n", "rootNote": 69, "rootFreq": 440.0 }),
        },
        Case {
            command: "get_link_status",
            name: "default_state",
            args: json!({}),
        },
        Case {
            command: "collab_get_nearby_sessions",
            name: "no_discovery_started",
            args: json!({}),
        },
        Case {
            command: "collab_get_document_state",
            name: "no_project_loaded",
            args: json!({ "docId": "project" }),
        },
    ]
}

fn build_app() -> App<MockRuntime> {
    mock_builder()
        .manage(commands::link::LinkState::default())
        .manage(commands::collab::CollabState::default())
        .invoke_handler(tauri::generate_handler![
            commands::tuning::parse_scl,
            commands::link::get_link_status,
            commands::collab::collab_get_nearby_sessions,
            commands::collab::collab_get_document_state,
        ])
        .build(mock_context(noop_assets()))
        .expect("mock app should build")
}

/// Run one case through the invoke pipeline and shape the answer as a fixture.
///
/// `outcome` is recorded separately from `payload` because Tauri sends the two
/// halves of a `Result` down different callbacks: a consumer that only compared
/// payloads would call a command that started failing "identical" as soon as the
/// error text happened to match.
fn record(webview: &WebviewWindow<MockRuntime>, case: &Case) -> Value {
    let response = tauri::test::get_ipc_response(
        webview,
        InvokeRequest {
            cmd: case.command.to_string(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(any(windows, target_os = "android")) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .expect("invoke url should parse"),
            body: InvokeBody::Json(case.args.clone()),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    );

    let (outcome, payload) = match response {
        Ok(body) => (
            "ok",
            body.deserialize::<Value>()
                .expect("an ok response should be JSON"),
        ),
        Err(value) => ("error", value),
    };

    json!({
        "command": case.command,
        "case": case.name,
        "args": case.args,
        "outcome": outcome,
        "payload": payload,
    })
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must sit inside the workspace")
        .join("scripts")
        .join("ipcFixtures")
}

/// How far two numbers may differ and still count as the same answer.
///
/// Not a softened assertion — a measured one. `parse_scl` builds its table with
/// `2f64.powf(...)`, and rebuilding this workspace from unchanged sources moved
/// entries of the recorded table by one unit in the last place: LLVM folds the
/// call at compile time in some builds and leaves it to libm in others, and the
/// two disagree in the final bit. Pinned to exact bits, this fixture would fail
/// on a rebuild that changed nothing, which is a gate that gets deleted rather
/// than believed.
///
/// The tolerance is relative and roughly five ULP, so it cannot hide anything a
/// parity run is looking for: a swapped field, a unit change, a wrong root note
/// and a renamed key all move a value by vastly more than this, and one part in
/// 1e15 of a frequency is far below the resolution of anything downstream.
/// Structure, key sets, array lengths, strings, booleans and nulls stay exact.
const NUMERIC_TOLERANCE: f64 = 1e-15;

fn numbers_match(expected: f64, actual: f64) -> bool {
    if expected == actual {
        return true;
    }
    if !expected.is_finite() || !actual.is_finite() {
        return false;
    }
    let scale = expected.abs().max(actual.abs());
    (expected - actual).abs() <= NUMERIC_TOLERANCE * scale
}

fn values_match(expected: &Value, actual: &Value) -> bool {
    match (expected, actual) {
        (Value::Number(left), Value::Number(right)) => match (left.as_f64(), right.as_f64()) {
            (Some(left), Some(right)) => numbers_match(left, right),
            _ => left == right,
        },
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right.iter())
                    .all(|(left, right)| values_match(left, right))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(key, left_value)| {
                    right
                        .get(key)
                        .is_some_and(|right_value| values_match(left_value, right_value))
                })
        }
        _ => expected == actual,
    }
}

/// Four-space pretty JSON, matching the repository's Prettier settings, so a
/// formatting pass never rewrites a recorded fixture.
fn to_pretty_json(value: &Value) -> String {
    let mut buffer = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b"    ");
    let mut serializer = serde_json::Serializer::with_formatter(&mut buffer, formatter);
    serde::Serialize::serialize(value, &mut serializer).expect("fixture should serialize");
    let mut text = String::from_utf8(buffer).expect("serialized fixture should be UTF-8");
    text.push('\n');
    text
}

#[test]
fn recorded_ipc_fixtures_match_the_live_tauri_responses() {
    let app = build_app();
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview should build");

    let update = std::env::var("SOURDAW_UPDATE_IPC_FIXTURES").as_deref() == Ok("1");
    let directory = fixtures_dir();
    if update {
        fs::create_dir_all(&directory).expect("fixture directory should be creatable");
    }

    let mut mismatches = Vec::new();
    for case in cases() {
        let recorded = record(&webview, &case);
        let path = directory.join(format!("{}.{}.json", case.command, case.name));

        if update {
            fs::write(&path, to_pretty_json(&recorded))
                .unwrap_or_else(|error| panic!("failed to write {}: {error}", path.display()));
            continue;
        }

        let committed = fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!(
                "missing fixture {} ({error}). Re-record with SOURDAW_UPDATE_IPC_FIXTURES=1.",
                path.display()
            )
        });
        // Compared as values, not bytes: the fixtures are Prettier-formatted
        // like every other JSON file in the repository, and a reformat must not
        // read as a wire-shape change.
        let expected: Value = serde_json::from_str(&committed)
            .unwrap_or_else(|error| panic!("fixture {} is not JSON: {error}", path.display()));

        if !values_match(&expected, &recorded) {
            mismatches.push(format!(
                "{}\n  recorded: {}\n  committed: {}",
                path.display(),
                recorded,
                expected
            ));
        }
    }

    assert!(
        mismatches.is_empty(),
        "IPC wire shape drifted from the recorded fixtures:\n{}",
        mismatches.join("\n")
    );
}
