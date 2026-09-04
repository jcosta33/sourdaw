/// Lock-free voice allocator using atomic bitfields.
///
/// Uses two `AtomicU64` values to track 128 voices as a 128-bit bitfield.
/// Finding a free voice uses `trailing_zeros()` for O(1) allocation.
/// Allocation uses `compare_exchange_weak` with `AcqRel` ordering.
///
/// Voice stealing follows this priority:
///   1. Same-note retrigger
///   2. Choke group match
///   3. Releasing voices (in release stage)
///   4. Oldest active voice
///   5. Quietest active voice
///   6. Voices already fading out (last resort — displacement preserves the fade)
use core::sync::atomic::{AtomicU64, Ordering};

use super::types::MAX_VOICES;

// ── Voice Allocator ────────────────────────────────────────────────────

/// Lock-free voice allocator for the RT audio thread.
///
/// Each bit in the two `AtomicU64` fields represents one voice slot:
///   - bit 0 = voice 0, bit 63 = voice 63 (in `slots_lo`)
///   - bit 0 = voice 64, bit 63 = voice 127 (in `slots_hi`)
///   - 0 = free, 1 = in use
pub struct VoiceAllocator {
    slots_lo: AtomicU64,
    slots_hi: AtomicU64,
}

impl VoiceAllocator {
    pub fn new() -> Self {
        Self {
            slots_lo: AtomicU64::new(0),
            slots_hi: AtomicU64::new(0),
        }
    }

    /// Try to allocate a free voice. Returns the voice index (0–127) or None.
    ///
    /// Uses `trailing_zeros()` to find the first free bit in O(1),
    /// then `compare_exchange_weak` to claim it atomically.
    pub fn allocate(&self) -> Option<usize> {
        // Try the low 64 bits first.
        if let Some(idx) = self.try_allocate_in(&self.slots_lo, 0) {
            return Some(idx);
        }
        // Then the high 64 bits.
        self.try_allocate_in(&self.slots_hi, 64)
    }

    /// Release a voice slot, marking it as free.
    pub fn release(&self, voice_index: usize) {
        debug_assert!(voice_index < MAX_VOICES);
        if voice_index < 64 {
            self.slots_lo
                .fetch_and(!(1u64 << voice_index), Ordering::Release);
        } else {
            self.slots_hi
                .fetch_and(!(1u64 << (voice_index - 64)), Ordering::Release);
        }
    }

    /// Check if a specific voice slot is currently in use.
    pub fn is_active(&self, voice_index: usize) -> bool {
        debug_assert!(voice_index < MAX_VOICES);
        if voice_index < 64 {
            self.slots_lo.load(Ordering::Acquire) & (1u64 << voice_index) != 0
        } else {
            self.slots_hi.load(Ordering::Acquire) & (1u64 << (voice_index - 64)) != 0
        }
    }

    /// Count the number of currently active voices.
    pub fn active_count(&self) -> u32 {
        let lo = self.slots_lo.load(Ordering::Relaxed);
        let hi = self.slots_hi.load(Ordering::Relaxed);
        lo.count_ones() + hi.count_ones()
    }

    /// Release all voice slots.
    pub fn release_all(&self) {
        self.slots_lo.store(0, Ordering::Release);
        self.slots_hi.store(0, Ordering::Release);
    }

    // ── Internal ───────────────────────────────────────────────────────

    fn try_allocate_in(&self, slots: &AtomicU64, base_index: usize) -> Option<usize> {
        loop {
            let current = slots.load(Ordering::Acquire);
            let inverted = !current;

            if inverted == 0 {
                // All 64 slots in use.
                return None;
            }

            let free_bit = inverted.trailing_zeros() as usize;
            let mask = 1u64 << free_bit;
            let new_val = current | mask;

            match slots.compare_exchange_weak(current, new_val, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => return Some(base_index + free_bit),
                Err(_) => {
                    // Another thread claimed a slot — retry.
                    continue;
                }
            }
        }
    }
}

impl Default for VoiceAllocator {
    fn default() -> Self {
        Self::new()
    }
}

// ── Voice Stealing ─────────────────────────────────────────────────────

/// Steal priority for a voice. Lower values = more likely to be stolen.
#[derive(Debug, Clone, Copy)]
pub struct StealCandidate {
    pub voice_index: usize,
    pub priority: StealPriority,
}

/// Priority categories for voice stealing, ordered from most-stealable to least.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum StealPriority {
    /// Same note being retriggered — the victim in every configuration, the
    /// incoming note's own choke group included. The one thing that keeps it
    /// from being taken is a fade already in flight: a fading voice reports
    /// [`StealPriority::Fading`] instead, below every live tier.
    SameNote,
    /// Voice belongs to a choke group that should be cut.
    ChokeGroup,
    /// Voice is in the release stage of its envelope.
    Releasing,
    /// Oldest active voice (highest age value → lowest priority).
    Oldest,
    /// Quietest active voice (lowest energy → lowest priority).
    Quietest,
    /// Voice is already running its de-click fade — a choke or an earlier
    /// steal has spent it, and it leaves the pool within
    /// [`FADE_STOLEN_SECS`](super::types::FADE_STOLEN_SECS) whatever this scan
    /// does. Stealable, because displacement preserves its fade:
    /// `move_voice_to_steal_tail` swaps the struct without resetting
    /// `steal_fade` and the tail renders the fade to silence. Ranked below
    /// every live tier so a scan with a live candidate still takes the voice
    /// it took before this tier existed — and a just-choked voice is never
    /// handed straight back to the note that choked it while anything else is
    /// on offer.
    Fading,
    /// No suitable candidate found.
    None,
}

/// Select the best voice to steal from a set of candidates.
///
/// Returns the index of the voice that should be stolen,
/// following the priority order: same-note > choke > releasing > oldest > quietest.
pub fn select_steal_target(candidates: &[StealCandidate]) -> Option<usize> {
    if candidates.is_empty() {
        return None;
    }

    let mut best: Option<&StealCandidate> = None;

    for candidate in candidates {
        if candidate.priority == StealPriority::None {
            continue;
        }

        match best {
            Some(current_best) => {
                if candidate.priority < current_best.priority {
                    best = Some(candidate);
                }
            }
            None => {
                best = Some(candidate);
            }
        }
    }

    best.map(|c| c.voice_index)
}
