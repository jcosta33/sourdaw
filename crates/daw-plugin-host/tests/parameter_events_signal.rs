//! The pending-events hint is one process-wide flag that every queue push in
//! the crate raises, and the library's own tests push on the harness's threads.
//! A test that asserts the hint reads back clear therefore cannot share a
//! process with them: any push landing between its two takes re-raises the
//! flag. This test binary is its own process, so nothing else touches the flag
//! here. Keep this file to that one assertion.

use daw_plugin_host::{
    take_pending_parameter_events_signal, PluginParameterEvent, PluginParameterEventQueue,
};

#[test]
fn the_pending_signal_is_raised_by_a_push_and_cleared_by_the_reader() {
    let queue = PluginParameterEventQueue::default();
    take_pending_parameter_events_signal();

    queue.push(PluginParameterEvent::value(1, 0.0));

    assert!(take_pending_parameter_events_signal());
    assert!(
        !take_pending_parameter_events_signal(),
        "the hint is read-and-clear, so an idle pass does no work"
    );
}
