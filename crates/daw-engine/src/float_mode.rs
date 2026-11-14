//! Denormal flushing for the threads that render audio.
//!
//! A decaying tail — a filter's state, a reverb's feedback, a release ramp —
//! passes through the subnormal range on its way to silence, and on most CPUs
//! arithmetic on subnormals takes a slow microcode path many times longer than
//! the ordinary one. On a render callback that is a deadline miss waiting to
//! happen, so every render entry holds a [`FlushDenormals`] for its whole
//! body: subnormal inputs read as zero and subnormal results are written as
//! zero, as every professional host does around its process call.
//!
//! The mode is set and restored per call rather than once per stream. The
//! platform backends do not promise the callback always runs on one thread
//! the engine could initialise, and a mode left set leaks into whatever else
//! that thread runs afterwards.

use std::marker::PhantomData;

#[cfg(any(
    target_arch = "x86_64",
    all(target_arch = "x86", target_feature = "sse")
))]
mod register {
    /// MXCSR.
    pub(crate) type Bits = u32;
    #[cfg(test)]
    pub(crate) type AtomicBits = std::sync::atomic::AtomicU32;

    /// FTZ (bit 15) flushes subnormal results; DAZ (bit 6) reads subnormal
    /// inputs as zero.
    pub(crate) const FLUSH: Bits = 0x8000 | 0x0040;

    #[inline(always)]
    pub(crate) fn read() -> Bits {
        let mut value: Bits = 0;
        // SAFETY: `stmxcsr` stores the 32-bit MXCSR into the slot the operand
        // points at, which is `value`, live and writable for the whole
        // instruction. SSE is part of the x86_64 baseline and is a compile-time
        // target feature on x86 by this module's cfg.
        unsafe {
            core::arch::asm!(
                "stmxcsr dword ptr [{}]",
                in(reg) &mut value,
                options(nostack, preserves_flags),
            );
        }
        value
    }

    #[inline(always)]
    pub(crate) fn write(value: Bits) {
        // SAFETY: `ldmxcsr` loads MXCSR from the slot the operand points at,
        // which is `value`, live for the whole instruction. Every value written
        // is one `read` returned, possibly with the FTZ and DAZ bits set, so no
        // reserved bit is ever set and the load cannot fault.
        unsafe {
            core::arch::asm!(
                "ldmxcsr dword ptr [{}]",
                in(reg) &value,
                options(nostack, readonly, preserves_flags),
            );
        }
    }
}

#[cfg(target_arch = "aarch64")]
mod register {
    /// FPCR.
    pub(crate) type Bits = u64;
    #[cfg(test)]
    pub(crate) type AtomicBits = std::sync::atomic::AtomicU64;

    /// FZ (bit 24) flushes subnormal inputs and results to zero.
    pub(crate) const FLUSH: Bits = 1 << 24;

    #[inline(always)]
    pub(crate) fn read() -> Bits {
        let value: Bits;
        // SAFETY: reading FPCR has no side effect and touches no memory.
        unsafe {
            core::arch::asm!(
                "mrs {}, fpcr",
                out(reg) value,
                options(nomem, nostack, preserves_flags),
            );
        }
        value
    }

    #[inline(always)]
    pub(crate) fn write(value: Bits) {
        // SAFETY: every value written is one `read` returned, possibly with FZ
        // set, so no reserved bit is ever set; writing FPCR touches no memory.
        unsafe {
            core::arch::asm!(
                "msr fpcr, {}",
                in(reg) value,
                options(nomem, nostack, preserves_flags),
            );
        }
    }
}

#[cfg(any(
    target_arch = "x86_64",
    all(target_arch = "x86", target_feature = "sse"),
    target_arch = "aarch64"
))]
mod mode {
    use super::register;

    pub(super) type Prior = register::Bits;

    #[inline(always)]
    pub(super) fn engage() -> Prior {
        let prior = register::read();
        register::write(prior | register::FLUSH);
        prior
    }

    #[inline(always)]
    pub(super) fn restore(prior: Prior) {
        register::write(prior);
    }
}

/// Architectures with no flush control this crate drives: the guard does
/// nothing.
#[cfg(not(any(
    target_arch = "x86_64",
    all(target_arch = "x86", target_feature = "sse"),
    target_arch = "aarch64"
)))]
mod mode {
    pub(super) type Prior = ();

    #[inline(always)]
    pub(super) fn engage() -> Prior {}

    #[inline(always)]
    pub(super) fn restore(_prior: Prior) {}
}

/// Flushes denormals on this thread until dropped, then puts back exactly the
/// control register this thread had before.
///
/// Two register instructions each way: no allocation, lock or syscall, so it
/// is safe at the top of a render callback. It is `!Send` because the
/// register it restores belongs to the thread that engaged it.
#[must_use = "denormals are flushed only while the guard is held"]
pub(crate) struct FlushDenormals {
    prior: mode::Prior,
    _thread_bound: PhantomData<*const ()>,
}

impl FlushDenormals {
    #[inline(always)]
    pub(crate) fn engage() -> Self {
        Self {
            prior: mode::engage(),
            _thread_bound: PhantomData,
        }
    }
}

impl Drop for FlushDenormals {
    #[inline(always)]
    fn drop(&mut self) {
        mode::restore(self.prior);
    }
}

/// Register access and a probe plugin for the tests that prove each render
/// entry holds the guard.
#[cfg(all(test, any(target_arch = "x86_64", target_arch = "aarch64")))]
pub(crate) mod test_support {
    use crate::plugin_slot::NativePlugin;
    use std::any::Any;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    pub(crate) use super::register::{read, write, AtomicBits, Bits, FLUSH};

    /// The thread's register with the flush bits cleared and asserted
    /// cleared, returning the original so the test can put it back.
    pub(crate) fn clear_flush_bits() -> Bits {
        let original = read();
        write(original & !FLUSH);
        assert_eq!(read() & FLUSH, 0, "the flush bits must start cleared");
        original
    }

    /// The thread's register with the flush bits set and asserted set,
    /// returning the original so the test can put it back.
    pub(crate) fn set_flush_bits() -> Bits {
        let original = read();
        write(original | FLUSH);
        assert_eq!(read() & FLUSH, FLUSH, "the flush bits must start set");
        original
    }

    /// Records the control register its render thread holds inside every
    /// process call, and how many calls it took.
    pub(crate) struct ControlRegisterProbe {
        seen: Arc<AtomicBits>,
        calls: Arc<AtomicUsize>,
    }

    /// The readings a [`ControlRegisterProbe`] leaves behind.
    #[derive(Clone)]
    pub(crate) struct ControlRegisterReadings {
        seen: Arc<AtomicBits>,
        calls: Arc<AtomicUsize>,
    }

    impl ControlRegisterReadings {
        pub(crate) fn last_seen(&self) -> Bits {
            self.seen.load(Ordering::Relaxed)
        }

        pub(crate) fn calls(&self) -> usize {
            self.calls.load(Ordering::Relaxed)
        }
    }

    pub(crate) fn control_register_probe() -> (ControlRegisterProbe, ControlRegisterReadings) {
        let seen = Arc::new(AtomicBits::new(0));
        let calls = Arc::new(AtomicUsize::new(0));
        (
            ControlRegisterProbe {
                seen: Arc::clone(&seen),
                calls: Arc::clone(&calls),
            },
            ControlRegisterReadings { seen, calls },
        )
    }

    impl NativePlugin for ControlRegisterProbe {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {
            self.seen.store(read(), Ordering::Relaxed);
            self.calls.fetch_add(1, Ordering::Relaxed);
        }

        fn name(&self) -> &str {
            "control-register-probe"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }
}

#[cfg(all(test, any(target_arch = "x86_64", target_arch = "aarch64")))]
mod tests {
    use super::test_support::{clear_flush_bits, read, set_flush_bits, write, FLUSH};
    use super::FlushDenormals;
    use std::hint::black_box;

    #[test]
    fn the_guard_sets_the_flush_bits_and_restores_the_prior_register_on_drop() {
        let original = clear_flush_bits();
        let before = read();

        let guard = FlushDenormals::engage();
        assert_eq!(read() & FLUSH, FLUSH, "the flush bits are set while held");
        assert_eq!(
            read() & !FLUSH,
            before & !FLUSH,
            "only the flush bits change"
        );
        drop(guard);

        assert_eq!(read(), before, "dropping restores the exact prior value");
        write(original);
    }

    #[test]
    fn nested_guards_each_restore_the_register_they_found() {
        let original = clear_flush_bits();
        let before = read();

        let outer = FlushDenormals::engage();
        let inside_outer = read();
        let inner = FlushDenormals::engage();
        assert_eq!(read(), inside_outer);
        drop(inner);
        assert_eq!(
            read(),
            inside_outer,
            "the inner guard restores the outer guard's mode, not the thread's original"
        );
        assert_eq!(read() & FLUSH, FLUSH);
        drop(outer);

        assert_eq!(read(), before);
        write(original);
    }

    #[test]
    fn a_guard_on_a_thread_already_flushing_leaves_it_flushing() {
        let original = set_flush_bits();
        let before = read();

        drop(FlushDenormals::engage());

        assert_eq!(
            read(),
            before,
            "restore puts back the prior value, set bits included"
        );
        write(original);
    }

    #[test]
    fn a_subnormal_result_is_flushed_to_zero_only_under_the_guard() {
        let original = clear_flush_bits();

        let unflushed = black_box(f32::MIN_POSITIVE) * black_box(0.5);
        let flushed = {
            let _guard = FlushDenormals::engage();
            black_box(f32::MIN_POSITIVE) * black_box(0.5)
        };

        assert!(
            unflushed.is_subnormal(),
            "without the guard the product is subnormal"
        );
        assert_eq!(
            flushed.to_bits(),
            0.0f32.to_bits(),
            "under the guard it is +0.0"
        );
        write(original);
    }
}
