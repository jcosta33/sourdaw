//! What a plugin says about its own parameters, carried off the thread it said
//! it on.
//!
//! A user turning a knob in a plugin's own editor produces two different
//! arrivals, and neither may do real work where it lands:
//!
//! * while the plugin is processing, the values come back through
//!   `clap_process.out_events`, which is the audio thread;
//! * while it is not, the plugin asks the host to call `params.flush()` and the
//!   values come back through that call's output list, which is the control
//!   thread.
//!
//! Both write into [`PluginParameterEventQueue`], a fixed-capacity wait-free
//! ring the control path drains. The queue is the record; nothing else is. It is
//! deliberately *not* a coalescing slot table like the host→plugin gesture queue
//! in `vst3_host`: order is the payload here, because a gesture boundary only
//! means anything relative to the values between it and its partner.
//!
//! Seam vocabulary rather than a CLAP one. VST3 raises the same three facts
//! through `IComponentHandler::beginEdit` / `performEdit` / `endEdit`, and its
//! backend fills the same queue.

use std::cell::UnsafeCell;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

/// How many plugin-generated events one instance holds between drains.
///
/// A power of two so the ring indexes with a mask: the producer runs on the
/// audio thread, where an integer division is a cost with no reason to exist.
///
/// Sized far above what a real plugin produces. The drain runs at
/// [`crate::parameter_events`]'s consumer interval and one editor gesture emits
/// at UI rate, so a full ride between two drains is a handful of events. A
/// queue this deep going full means the plugin is emitting pathologically, and
/// that case is reported rather than hidden — see [`PluginParameterEventQueue::push`].
pub const PARAMETER_EVENT_CAPACITY: usize = 512;

/// What one plugin-generated event says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginParameterEventKind {
    /// The plugin opened an edit. Every value until the matching end belongs to
    /// one continuous user gesture — a knob held, not a knob nudged.
    GestureBegin,
    /// The plugin's own value for this parameter changed.
    Value,
    /// The plugin closed the edit it opened.
    GestureEnd,
}

/// One thing a plugin reported about one of its parameters.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PluginParameterEvent {
    /// The plugin's own parameter id, the same number `get_parameters` reports.
    pub param_id: u32,
    pub kind: PluginParameterEventKind,
    /// The value the plugin reported, in the plugin's own units.
    ///
    /// Meaningful only for [`PluginParameterEventKind::Value`]. A gesture
    /// boundary carries an identity and no value, and reads `0.0` here rather
    /// than repeating a value the plugin never stated at that boundary.
    pub value: f64,
}

impl PluginParameterEvent {
    pub const fn value(param_id: u32, value: f64) -> Self {
        Self {
            param_id,
            kind: PluginParameterEventKind::Value,
            value,
        }
    }

    pub const fn gesture_begin(param_id: u32) -> Self {
        Self {
            param_id,
            kind: PluginParameterEventKind::GestureBegin,
            value: 0.0,
        }
    }

    pub const fn gesture_end(param_id: u32) -> Self {
        Self {
            param_id,
            kind: PluginParameterEventKind::GestureEnd,
            value: 0.0,
        }
    }
}

/// A fixed-capacity wait-free ring for plugin-generated parameter events.
///
/// # Real-time contract
///
/// [`push`](Self::push) is called from `clap_process.out_events.try_push`, which
/// runs inside the plugin's `process()` on the audio thread. Every operation it
/// performs is bounded and lock-free: two atomic loads, one masked index, one
/// plain store into memory allocated when the queue was built, two atomic stores
/// (the write cursor and the process-wide pending hint), and — only when the
/// queue is full — one atomic fetch-add instead of both stores. No allocation, no
/// lock, no syscall, no division, no unbounded loop.
///
/// # Producer discipline
///
/// One producer at a time, not one producer thread. The two callers that push —
/// the plugin's `process()` and the plugin's `params.flush()` — each hold the
/// wrapper exclusively (`&mut ClapWrapper`), and the runtime owner never lets
/// the audio path and the control path into the wrapper at once. That, not
/// thread identity, is what makes the single-producer indices sound.
///
/// The consumer is the drain thread, and it is single by construction: the queue
/// is drained from one watcher and nowhere else.
pub struct PluginParameterEventQueue {
    /// Preallocated slots. `UnsafeCell` because the producer writes a slot the
    /// consumer is not looking at, which the index discipline below guarantees
    /// and the borrow checker cannot see.
    slots: Box<[UnsafeCell<PluginParameterEvent>]>,
    /// Index mask. `slots.len()` is a power of two, so `index & mask` is the
    /// slot — no division on the audio thread.
    mask: usize,
    /// Monotonic write cursor. Written by the producer only.
    write: AtomicUsize,
    /// Monotonic read cursor. Written by the consumer only.
    read: AtomicUsize,
    /// Events the queue had no room for since the last drain.
    dropped: AtomicU32,
}

// SAFETY: every field is either immutable after construction or an atomic, and
// the slots are only ever touched under the single-producer / single-consumer
// index discipline documented on the type.
unsafe impl Send for PluginParameterEventQueue {}
unsafe impl Sync for PluginParameterEventQueue {}

impl Default for PluginParameterEventQueue {
    fn default() -> Self {
        Self::with_capacity(PARAMETER_EVENT_CAPACITY)
    }
}

impl PluginParameterEventQueue {
    /// Build a queue holding `capacity` events.
    ///
    /// # Panics
    /// When `capacity` is not a power of two. It is a constant at every call
    /// site, so this cannot fire at runtime for a reason a user could produce —
    /// and a silently rounded capacity would make the mask index the wrong slot.
    pub fn with_capacity(capacity: usize) -> Self {
        assert!(
            capacity.is_power_of_two(),
            "parameter event queue capacity must be a power of two"
        );
        let slots = (0..capacity)
            .map(|_| UnsafeCell::new(PluginParameterEvent::value(0, 0.0)))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        Self {
            mask: capacity - 1,
            slots,
            write: AtomicUsize::new(0),
            read: AtomicUsize::new(0),
            dropped: AtomicU32::new(0),
        }
    }

    /// Record one event. **Wait-free; safe on the audio thread.**
    ///
    /// Reports whether the queue took it. A full queue counts the loss and
    /// answers `false`, which is what the CLAP output list is allowed to tell a
    /// plugin — an honest refusal the plugin may retry on its next block beats
    /// an acceptance that silently discards.
    pub fn push(&self, event: PluginParameterEvent) -> bool {
        let write = self.write.load(Ordering::Relaxed);
        let read = self.read.load(Ordering::Acquire);

        if write.wrapping_sub(read) >= self.slots.len() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return false;
        }

        // SAFETY: the slot is at least one ahead of the consumer's cursor, which
        // the capacity check above establishes, so nothing is reading it.
        unsafe { *self.slots[write & self.mask].get() = event };
        // Published after the slot is written, so a consumer that sees this
        // cursor sees the event behind it.
        self.write.store(write.wrapping_add(1), Ordering::Release);
        signal_pending_parameter_events();
        true
    }

    /// Move every waiting event into `out`, in the order the plugin produced
    /// them. **Consumer thread only.**
    pub fn drain(&self, out: &mut Vec<PluginParameterEvent>) {
        let read = self.read.load(Ordering::Relaxed);
        let write = self.write.load(Ordering::Acquire);

        let mut cursor = read;
        while cursor != write {
            // SAFETY: every index below `write` has been published by the
            // producer and is not written again until the read cursor passes it.
            out.push(unsafe { *self.slots[cursor & self.mask].get() });
            cursor = cursor.wrapping_add(1);
        }

        self.read.store(cursor, Ordering::Release);
    }

    /// Read and clear how many events the queue had no room for.
    pub fn take_dropped(&self) -> u32 {
        self.dropped.swap(0, Ordering::AcqRel)
    }

    /// Whether anything is waiting. Cheap enough to ask on every drain pass.
    pub fn has_pending(&self) -> bool {
        self.write.load(Ordering::Acquire) != self.read.load(Ordering::Relaxed)
    }
}

/// Process-wide hint that some queue has something in it.
///
/// A coalescing hint, never the record — each queue's ring is the record. It
/// exists so an idle session costs one atomic swap per drain interval instead of
/// a lock and a map walk, and a lost signal costs at most one interval of
/// latency because the next pass reads the queues anyway.
static PARAMETER_EVENTS_PENDING: AtomicBool = AtomicBool::new(false);

fn signal_pending_parameter_events() {
    PARAMETER_EVENTS_PENDING.store(true, Ordering::Release);
}

/// Read and clear the hint. The drain thread's first question on every pass.
pub fn take_pending_parameter_events_signal() -> bool {
    PARAMETER_EVENTS_PENDING.swap(false, Ordering::AcqRel)
}

/// Process-wide hint that some plugin asked its host to call `params.flush()`.
///
/// Separate from the event hint because the two ticks cost different things: an
/// event drain reads lock-free rings, while answering a flush takes each
/// instance's control seam. Coalescing them would make every parameter edit pay
/// for a seam the flush path needs and the drain does not.
///
/// A hint, never the record — each instance's own flag is. A lost signal costs
/// at most one drain interval, because the flag stays set until a pass takes it.
static PARAMETER_FLUSH_PENDING: AtomicBool = AtomicBool::new(false);

/// Raise the flush hint. **Called from the plugin's own thread, which CLAP marks
/// `[thread-safe]` for `request_flush` — so this may be the audio thread.**
///
/// One release store, and nothing else. That is the whole reason this exists: a
/// channel wake would copy an instance id and take an allocator lock on the
/// render thread.
pub fn signal_pending_parameter_flush() {
    PARAMETER_FLUSH_PENDING.store(true, Ordering::Release);
}

/// Read and clear the flush hint. The drain thread's second question.
pub fn take_pending_parameter_flush_signal() -> bool {
    PARAMETER_FLUSH_PENDING.swap(false, Ordering::AcqRel)
}

/// One instance's drained batch, after gesture pairing.
#[derive(Debug, Default, PartialEq)]
pub struct PairedParameterEvents {
    pub events: Vec<PluginParameterEvent>,
    /// Events the queue had no room for. Non-zero means the stream is lossy.
    pub dropped: u32,
}

/// Fold one drained batch against the gestures this instance already has open.
///
/// Three things a consumer must never be handed, because each one leaves a
/// recorder in a state the plugin never asked for:
///
/// * a second begin for a parameter already open — it would nest a gesture that
///   has no nesting, and the first end would close only the inner one;
/// * an end for a parameter that was never opened — it would release a touch
///   nobody took, which in latch mode is what ends a pass;
/// * an open gesture left standing after a lossy drain. A dropped event can be
///   an end, and a touch the host never releases holds its lane in write mode
///   for the rest of the instance's life. So any drop closes every gesture still
///   open: closing early costs the tail of one ride, and not closing costs the
///   lane.
///
/// `open` is per instance and lives with the drain that owns it, so a gesture a
/// plugin never ended dies when the instance is forgotten rather than leaking
/// onto whatever loads next.
pub fn pair_gestures(
    open: &mut HashSet<u32>,
    drained: Vec<PluginParameterEvent>,
    dropped: u32,
) -> PairedParameterEvents {
    let mut events = Vec::with_capacity(drained.len());

    for event in drained {
        match event.kind {
            PluginParameterEventKind::GestureBegin => {
                if !open.insert(event.param_id) {
                    continue;
                }
            }
            PluginParameterEventKind::GestureEnd => {
                if !open.remove(&event.param_id) {
                    continue;
                }
            }
            PluginParameterEventKind::Value => {}
        }
        events.push(event);
    }

    if dropped > 0 {
        let mut abandoned = open.drain().collect::<Vec<_>>();
        // The set has no order of its own, and an event stream that varies run
        // to run is one no test can pin.
        abandoned.sort_unstable();
        events.extend(abandoned.into_iter().map(PluginParameterEvent::gesture_end));
    }

    PairedParameterEvents { events, dropped }
}

/// Whether a drained batch carries anything worth publishing.
pub fn is_empty_batch(batch: &PairedParameterEvents) -> bool {
    batch.events.is_empty() && batch.dropped == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pending hint is process-wide, so any test that pushes raises it for
    /// every other test running beside it. The one test that reads the hint back
    /// and the one test that pushes concurrently both take this, because
    /// otherwise the pusher re-raises the hint between the reader's take and its
    /// assertion that a second take finds nothing.
    static EVENTS_SIGNAL_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn drained(queue: &PluginParameterEventQueue) -> Vec<PluginParameterEvent> {
        let mut out = Vec::new();
        queue.drain(&mut out);
        out
    }

    #[test]
    fn a_pushed_event_is_drained_back_unchanged() {
        let queue = PluginParameterEventQueue::default();

        assert!(queue.push(PluginParameterEvent::value(7, 0.25)));

        assert_eq!(drained(&queue), vec![PluginParameterEvent::value(7, 0.25)]);
    }

    /// Order is the payload: a gesture boundary only means anything relative to
    /// the values between it and its partner, so a queue that coalesced or
    /// reordered would destroy exactly the fact this path exists to carry.
    #[test]
    fn events_drain_in_the_order_the_plugin_produced_them() {
        let queue = PluginParameterEventQueue::default();

        queue.push(PluginParameterEvent::gesture_begin(3));
        queue.push(PluginParameterEvent::value(3, 0.1));
        queue.push(PluginParameterEvent::value(3, 0.9));
        queue.push(PluginParameterEvent::gesture_end(3));

        assert_eq!(
            drained(&queue),
            vec![
                PluginParameterEvent::gesture_begin(3),
                PluginParameterEvent::value(3, 0.1),
                PluginParameterEvent::value(3, 0.9),
                PluginParameterEvent::gesture_end(3),
            ]
        );
    }

    #[test]
    fn a_drain_clears_the_queue() {
        let queue = PluginParameterEventQueue::default();
        queue.push(PluginParameterEvent::value(1, 0.5));

        drained(&queue);

        assert!(!queue.has_pending());
        assert!(drained(&queue).is_empty());
    }

    /// The producer is the audio thread and it may not wait, so the only answer
    /// to a full queue is a refusal it counts. The count is what tells the
    /// consumer its stream went lossy.
    #[test]
    fn a_full_queue_refuses_and_counts_rather_than_overwriting() {
        let queue = PluginParameterEventQueue::with_capacity(4);

        for step in 0..4u32 {
            assert!(queue.push(PluginParameterEvent::value(step, f64::from(step))));
        }
        assert!(!queue.push(PluginParameterEvent::value(99, 1.0)));
        assert!(!queue.push(PluginParameterEvent::value(98, 1.0)));

        assert_eq!(queue.take_dropped(), 2);
        assert_eq!(
            drained(&queue),
            (0..4u32)
                .map(|step| PluginParameterEvent::value(step, f64::from(step)))
                .collect::<Vec<_>>(),
            "the events already accepted survive an overflow untouched"
        );
    }

    #[test]
    fn taking_the_drop_count_clears_it() {
        let queue = PluginParameterEventQueue::with_capacity(1);
        queue.push(PluginParameterEvent::value(0, 0.0));
        queue.push(PluginParameterEvent::value(1, 1.0));

        assert_eq!(queue.take_dropped(), 1);
        assert_eq!(queue.take_dropped(), 0);
    }

    /// A drain frees the slots it took, or one busy block would retire the queue
    /// for the rest of the session.
    #[test]
    fn draining_makes_room_for_the_next_block() {
        let queue = PluginParameterEventQueue::with_capacity(2);
        queue.push(PluginParameterEvent::value(0, 0.0));
        queue.push(PluginParameterEvent::value(1, 1.0));
        assert!(!queue.push(PluginParameterEvent::value(2, 2.0)));

        drained(&queue);

        assert!(queue.push(PluginParameterEvent::value(2, 2.0)));
        assert_eq!(drained(&queue), vec![PluginParameterEvent::value(2, 2.0)]);
    }

    #[test]
    fn the_pending_signal_is_raised_by_a_push_and_cleared_by_the_reader() {
        let _guard = EVENTS_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let queue = PluginParameterEventQueue::default();
        take_pending_parameter_events_signal();

        queue.push(PluginParameterEvent::value(1, 0.0));

        assert!(take_pending_parameter_events_signal());
        assert!(
            !take_pending_parameter_events_signal(),
            "the hint is read-and-clear, so an idle pass does no work"
        );
    }

    #[test]
    fn a_refused_push_still_reports_pending_work_from_the_events_it_could_not_take() {
        let queue = PluginParameterEventQueue::with_capacity(1);
        queue.push(PluginParameterEvent::value(0, 0.0));
        take_pending_parameter_events_signal();

        assert!(!queue.push(PluginParameterEvent::value(1, 0.0)));

        assert_eq!(
            queue.take_dropped(),
            1,
            "the drop is recorded even though no signal was raised for it"
        );
    }

    #[test]
    fn pairing_keeps_a_well_formed_gesture_whole() {
        let mut open = HashSet::new();
        let batch = pair_gestures(
            &mut open,
            vec![
                PluginParameterEvent::gesture_begin(2),
                PluginParameterEvent::value(2, 0.4),
                PluginParameterEvent::gesture_end(2),
            ],
            0,
        );

        assert_eq!(
            batch.events,
            vec![
                PluginParameterEvent::gesture_begin(2),
                PluginParameterEvent::value(2, 0.4),
                PluginParameterEvent::gesture_end(2),
            ]
        );
        assert!(open.is_empty(), "a closed gesture leaves nothing open");
    }

    /// A gesture that spans two drains is still one gesture: the open set is
    /// what carries it across, and a second begin must not re-open it.
    #[test]
    fn a_repeated_begin_for_an_open_gesture_is_dropped() {
        let mut open = HashSet::new();
        pair_gestures(&mut open, vec![PluginParameterEvent::gesture_begin(5)], 0);

        let batch = pair_gestures(
            &mut open,
            vec![
                PluginParameterEvent::gesture_begin(5),
                PluginParameterEvent::value(5, 0.2),
            ],
            0,
        );

        assert_eq!(batch.events, vec![PluginParameterEvent::value(5, 0.2)]);
        assert!(
            open.contains(&5),
            "the original gesture is still the open one"
        );
    }

    /// An end with no begin releases a touch nobody took — in latch mode that is
    /// what ends a recording pass, so forwarding it would stop a pass the user
    /// never stopped.
    #[test]
    fn an_end_with_no_open_gesture_is_dropped() {
        let mut open = HashSet::new();

        let batch = pair_gestures(&mut open, vec![PluginParameterEvent::gesture_end(9)], 0);

        assert!(batch.events.is_empty());
    }

    /// A dropped event can be a gesture end, and an unreleased touch holds its
    /// lane in write mode for the rest of the instance's life. Closing early
    /// costs the tail of one ride; not closing costs the lane.
    #[test]
    fn a_lossy_drain_closes_every_gesture_it_can_no_longer_vouch_for() {
        let mut open = HashSet::new();
        pair_gestures(
            &mut open,
            vec![
                PluginParameterEvent::gesture_begin(4),
                PluginParameterEvent::gesture_begin(1),
            ],
            0,
        );

        let batch = pair_gestures(&mut open, vec![PluginParameterEvent::value(4, 0.7)], 3);

        assert_eq!(
            batch.events,
            vec![
                PluginParameterEvent::value(4, 0.7),
                PluginParameterEvent::gesture_end(1),
                PluginParameterEvent::gesture_end(4),
            ],
            "the surviving values still publish, then every open gesture is closed in id order"
        );
        assert_eq!(batch.dropped, 3);
        assert!(open.is_empty());
    }

    #[test]
    fn a_batch_with_neither_events_nor_drops_is_not_worth_publishing() {
        assert!(is_empty_batch(&PairedParameterEvents::default()));
        assert!(!is_empty_batch(&PairedParameterEvents {
            events: Vec::new(),
            dropped: 1,
        }));
    }

    /// The queue's whole purpose is to cross a thread boundary — the plugin
    /// pushes on the audio thread and the watcher drains on its own — and every
    /// test above it runs both ends on one thread, where the acquire/release
    /// pairing that makes a published slot visible is never exercised at all.
    ///
    /// This drives the real topology: one producer thread, one consumer thread,
    /// every event accounted for and in order. What it catches everywhere is a
    /// producer or consumer that loses, duplicates or reorders under contention.
    /// On a weakly-ordered host it also catches the fences themselves — relaxing
    /// the write cursor's store/load pair breaks the order assertion here — while
    /// a strongly-ordered one may let that mutation through, so the ordering is
    /// argued from the acquire/release pairing rather than from this test alone.
    #[test]
    fn every_event_one_thread_pushes_reaches_the_thread_draining_it_in_order() {
        use std::sync::Arc;

        let _guard = EVENTS_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        // Deliberately far more events than slots, so the consumer must actually
        // keep up and the producer must actually see the room it frees.
        const CAPACITY: usize = 16;
        const EVENTS: u32 = 10_000;

        let queue = Arc::new(PluginParameterEventQueue::with_capacity(CAPACITY));
        let producer_queue = Arc::clone(&queue);

        let producer = std::thread::spawn(move || {
            let mut sent = 0u32;
            while sent < EVENTS {
                // Retrying a refusal is what the CLAP output-list contract lets
                // a plugin do, and it keeps this test about ordering rather
                // than about how fast the consumer happens to run. Each refusal
                // still bumps the drop counter, which counts refusals rather
                // than losses, so nothing here asserts that counter is zero.
                if producer_queue.push(PluginParameterEvent::value(sent, f64::from(sent))) {
                    sent += 1;
                }
            }
        });

        let mut observed = Vec::with_capacity(EVENTS as usize);
        let mut batch = Vec::new();
        while (observed.len() as u32) < EVENTS {
            queue.drain(&mut batch);
            observed.append(&mut batch);
        }
        producer.join().expect("the producer thread finishes");

        assert_eq!(
            observed.len() as u32,
            EVENTS,
            "no event may be lost or duplicated"
        );
        let out_of_order = observed
            .iter()
            .enumerate()
            .find(|(index, event)| event.param_id != *index as u32);
        assert!(
            out_of_order.is_none(),
            "events must arrive in the order the producer pushed them, first break at {:?}",
            out_of_order
        );
    }
}
