//! Replug detection for native MIDI input ports (#2016).
//!
//! midir offers no OS hot-plug callback that reaches this crate, so a device
//! that is replugged — or a hub that power-cycles — is invisible until
//! something re-enumerates. This watcher is that something: a dedicated
//! non-RT thread that polls the port table on a slow cadence, fingerprints it,
//! and pushes `midi-ports-changed` to the shell only when the fingerprint
//! changed. An idle session costs one cheap enumeration per interval and
//! emits nothing.
//!
//! The event is a tick, not a report: the frontend re-enumerates when it
//! arrives rather than trusting a payload, so the payload is empty. The same
//! rule the CLAP latency watcher follows applies here — the emit decision is
//! split out of the thread body so it is testable without a device.

use crate::events::EventSink;
use midir::MidiInput;
use std::sync::Arc;
use std::time::Duration;

/// Wire event name. The TS listener mirrors this string verbatim — never rename.
pub const MIDI_PORTS_CHANGED_EVENT: &str = "midi-ports-changed";

/// How often the watcher re-reads the port table.
///
/// Slow enough that an idle session's cost is one `MidiInput::new` plus a
/// port-table read per interval — enumeration never opens a device — and fast
/// enough that a replug is noticed well inside a musician's "nothing is
/// happening" window.
const PORT_POLL_INTERVAL: Duration = Duration::from_secs(1);

/// What one poll knows about the port set: `(id, name)` per port, in
/// enumeration order. The ids are what the frontend persists, so a change in
/// this list is exactly a change the frontend must react to.
type PortFingerprint = Vec<(String, String)>;

/// Enumerate the current ports as a fingerprint, or `None` when the backend
/// could not be reached this cycle. A skipped cycle is not a change: a
/// transient failure must not emit a phantom replug.
fn current_fingerprint() -> Option<PortFingerprint> {
    let midi_in = MidiInput::new("sourdaw-port-watch").ok()?;
    let ports = midi_in.ports();
    let named: Vec<(String, String)> = ports
        .iter()
        .map(|port| {
            let name = midi_in.port_name(port).unwrap_or_default();
            (port.id(), name)
        })
        .collect();
    let ids = super::midi::assign_port_ids(&named);
    Some(
        named
            .into_iter()
            .zip(ids)
            .map(|((_, name), id)| (id, name))
            .collect(),
    )
}

/// Whether one poll's fingerprint differs from the last one seen.
///
/// A first observation is the baseline, not an event: the frontend enumerates
/// at init anyway, so emitting there would only send the listener on a
/// redundant restore pass at startup.
fn fingerprint_changed(previous: &Option<PortFingerprint>, current: &PortFingerprint) -> bool {
    match previous {
        Some(previous) => previous != current,
        None => false,
    }
}

/// Run one poll against a known port set.
///
/// The thread body delegates here so the emit rule is testable without a live
/// device: the baseline poll and an unchanged poll emit nothing, a changed one
/// emits exactly one tick.
fn poll_fingerprint(
    last: &mut Option<PortFingerprint>,
    current: PortFingerprint,
    events: &dyn EventSink,
) {
    if !fingerprint_changed(last, &current) {
        // Seed the baseline on the very first poll; afterwards an unchanged
        // poll carries identical content, so the stored value is the same.
        if last.is_none() {
            *last = Some(current);
        }
        return;
    }

    *last = Some(current);
    // The event is a tick: the listener re-enumerates rather than trusting a
    // payload, so none is sent.
    events.emit_json(MIDI_PORTS_CHANGED_EVENT, serde_json::Value::Null);
}

/// Start the watcher thread. Started once, at host construction; the thread
/// lives for the process, and the sink it holds is a weak threadsafe function,
/// so the thread never pins the shell's event loop.
pub fn start(events: Arc<dyn EventSink>) {
    let spawned = std::thread::Builder::new()
        .name("midi-port-watcher".to_string())
        .spawn(move || {
            let mut last: Option<PortFingerprint> = None;
            loop {
                std::thread::sleep(PORT_POLL_INTERVAL);
                if let Some(current) = current_fingerprint() {
                    poll_fingerprint(&mut last, current, events.as_ref());
                }
            }
        });

    if let Err(error) = spawned {
        eprintln!("[MIDI] failed to start the MIDI port watcher: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Records every `(event, payload)` the watcher pushed, the way the
    /// latency watcher's tests observe their payload decisions.
    struct RecordingEventSink {
        events: Mutex<Vec<(String, serde_json::Value)>>,
    }

    impl RecordingEventSink {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
            }
        }

        fn recorded(&self) -> Vec<(String, serde_json::Value)> {
            self.events
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
        }

        fn event_names(&self) -> Vec<String> {
            self.recorded()
                .into_iter()
                .map(|(event, _)| event)
                .collect()
        }
    }

    impl EventSink for RecordingEventSink {
        fn emit_json(&self, event: &str, payload: serde_json::Value) {
            self.events
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push((event.to_string(), payload));
        }
    }

    fn fingerprint(entries: &[(&str, &str)]) -> PortFingerprint {
        entries
            .iter()
            .map(|(id, name)| ((*id).to_string(), (*name).to_string()))
            .collect()
    }

    #[test]
    fn the_baseline_poll_and_identical_polls_emit_nothing() {
        let events = RecordingEventSink::new();
        let ports = fingerprint(&[("254", "Launchkey"), ("817", "MPK Mini")]);
        let mut last = None;

        poll_fingerprint(&mut last, ports.clone(), &events);
        poll_fingerprint(&mut last, ports.clone(), &events);
        poll_fingerprint(&mut last, ports, &events);

        assert!(
            events.recorded().is_empty(),
            "the baseline and unchanged polls must not announce a replug that never happened"
        );
    }

    #[test]
    fn a_changed_port_set_emits_exactly_one_tick() {
        let events = RecordingEventSink::new();
        let mut last = Some(fingerprint(&[("254", "Launchkey")]));
        let replugged = fingerprint(&[("254", "Launchkey"), ("817", "MPK Mini")]);

        poll_fingerprint(&mut last, replugged, &events);

        assert_eq!(
            events.event_names(),
            vec![MIDI_PORTS_CHANGED_EVENT.to_string()]
        );
    }

    /// The listener re-enumerates on receipt, so the tick carries no report —
    /// pinned here so a payload appearing is a deliberate contract edit
    /// mirrored on the TS side, not an accident.
    #[test]
    fn the_tick_is_empty_the_listener_must_not_trust_it() {
        let events = RecordingEventSink::new();
        let mut last = Some(fingerprint(&[("254", "Launchkey")]));

        poll_fingerprint(&mut last, fingerprint(&[]), &events);

        assert_eq!(
            events.recorded(),
            vec![(
                MIDI_PORTS_CHANGED_EVENT.to_string(),
                serde_json::Value::Null
            )]
        );
    }

    #[test]
    fn a_device_that_leaves_and_returns_emits_one_tick_per_transition() {
        let events = RecordingEventSink::new();
        let full = fingerprint(&[("254", "Launchkey"), ("817", "MPK Mini")]);
        let missing = fingerprint(&[("254", "Launchkey")]);
        let mut last = Some(full.clone());

        poll_fingerprint(&mut last, missing.clone(), &events);
        poll_fingerprint(&mut last, missing, &events);
        poll_fingerprint(&mut last, full, &events);

        assert_eq!(
            events.recorded().len(),
            2,
            "unplug and replug are two changes; the unchanged poll between them must stay silent"
        );
    }

    #[test]
    fn the_unchanged_poll_still_seeds_the_baseline_fingerprint() {
        let mut last = None;
        let ports = fingerprint(&[("254", "Launchkey")]);

        poll_fingerprint(&mut last, ports.clone(), &RecordingEventSink::new());

        assert_eq!(last, Some(ports));
    }

    /// A poll the backend could not serve is dropped on the thread body's
    /// side; this pins the pure rule underneath it — no previous observation
    /// is never a change — directly.
    #[test]
    fn a_first_observation_is_a_baseline_not_a_change() {
        let ports = fingerprint(&[("254", "Launchkey")]);

        assert!(!fingerprint_changed(&None, &ports));
        assert!(fingerprint_changed(&Some(ports.clone()), &fingerprint(&[])));
        assert!(!fingerprint_changed(
            &Some(ports),
            &fingerprint(&[("254", "Launchkey")])
        ));
    }
}
