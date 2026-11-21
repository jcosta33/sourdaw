//! A CLAP editor's `clap.timer-support` and `clap.posix-fd-support`
//! registrations, served by the host's editor pump through the real
//! `ClapWrapper`. Linux only: it is the one platform the host offers the
//! extensions on, because it is the one the shell pumps editor run loops on.
//!
//! The test stands where the shell's UI thread stands: it opens the editor
//! and calls `service_editor_run_loops` itself. It is this binary's only test,
//! so nothing else registers with the process-wide pump while it runs.

#![cfg(target_os = "linux")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "tests assert by unwrapping"
)]

use std::ptr;
use std::time::{Duration, Instant};

use daw_plugin_host::editor_run_loop::service_editor_run_loops;
use daw_plugin_host::{AudioPlugin, ClapWrapper, ProcessMode};
use sourdaw_harness_fx::state::{decode_gui, RunLoopRecord};
use sourdaw_harness_fx::CLAP_EDITOR_PLUGIN_ID;

mod support;
use support::InstalledPlugin;

/// Longer than the fixture's 1 ms timers take to come due again.
const TURN: Duration = Duration::from_millis(5);
const PATIENCE: Duration = Duration::from_secs(5);

fn run_loop_record(wrapper: &ClapWrapper) -> RunLoopRecord {
    decode_gui(&wrapper.get_state().unwrap())
        .expect("the chunk is the editor class's own")
        .1
        .run_loop
}

/// One shell turn: wait for the timers to come due, then pump.
fn turn() -> usize {
    std::thread::sleep(TURN);
    service_editor_run_loops()
}

/// Pump until `done` holds for the instance's record, or give up.
fn pump_until(wrapper: &ClapWrapper, done: impl Fn(&RunLoopRecord) -> bool) -> RunLoopRecord {
    let deadline = Instant::now() + PATIENCE;
    loop {
        turn();
        let record = run_loop_record(wrapper);
        if done(&record) || Instant::now() > deadline {
            return record;
        }
    }
}

/// TEMPORARY diagnostic for a CI-only crash: written straight to the stderr
/// descriptor, past the test harness's capture, so a signal cannot swallow it.
fn phase(name: &str) {
    use std::io::Write;
    let mut stderr = std::io::stderr();
    let _ = writeln!(stderr, "[clap_run_loop phase] {name}");
    let _ = stderr.flush();
}

#[test]
fn an_editors_timer_and_descriptor_fire_on_the_pump_until_it_closes_and_nothing_after_drop() {
    phase("start");
    let plugin = InstalledPlugin::create("clap-run-loop");
    let mut wrapper = plugin
        .clap(CLAP_EDITOR_PLUGIN_ID, ProcessMode::Realtime)
        .expect("the editor class should load and activate");
    phase("loaded");
    assert!(
        run_loop_record(&wrapper).offered,
        "the host offers both extensions on Linux"
    );

    wrapper
        .open_gui(ptr::null_mut())
        .expect("the editor class should open its editor");
    phase("opened");
    let open = pump_until(&wrapper, |record| {
        record.editor_timer_fires > 0 && record.editor_fd_fires > 0
    });
    phase(&format!("pumped open: {open:?}"));
    assert!(
        open.editor_timer_fires > 0,
        "the editor's timer fired: {open:?}"
    );
    assert!(
        open.editor_fd_fires > 0,
        "the editor's pipe was delivered: {open:?}"
    );
    assert!(
        open.all_on_creating_thread,
        "every editor callback ran on the thread that created the editor"
    );

    wrapper.close_gui();
    phase("closed");
    let at_close = run_loop_record(&wrapper);
    let closed = pump_until(&wrapper, |record| {
        record.init_timer_fires > at_close.init_timer_fires
    });
    phase(&format!("pumped closed: {closed:?}"));
    assert!(
        closed.init_timer_fires > at_close.init_timer_fires,
        "the pump still serves the instance: its init-time timer keeps firing"
    );
    assert_eq!(
        (closed.editor_timer_fires, closed.editor_fd_fires),
        (at_close.editor_timer_fires, at_close.editor_fd_fires),
        "a closed editor's timer and descriptor were unregistered and never fire"
    );

    drop(wrapper);
    phase("dropped");
    let after_drop: usize = (0..10).map(|_| turn()).sum();
    phase("pumped after drop");
    assert_eq!(
        after_drop, 0,
        "a dropped instance has left the pump, init-time timer and all"
    );
    drop(plugin);
    phase("end");
}
