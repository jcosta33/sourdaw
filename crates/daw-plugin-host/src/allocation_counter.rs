//! The test binary's global allocator: it counts allocations per thread, so a
//! test can assert that a path it drives on its own thread allocated nothing.
//!
//! One crate-level home because a test binary has one global allocator, and
//! more than one module's tests measure real-time paths against it.

use std::cell::Cell;

/// A counting allocator that counts *per thread*.
///
/// Per thread rather than per process because `cargo test` runs these tests
/// concurrently: a global counter would pick up every other test's allocations
/// and fail this one for reasons that have nothing to do with the render path.
///
/// The counter is a `Cell` behind a `const`-initialised thread local, so reading
/// or incrementing it allocates nothing itself and cannot recurse into the
/// allocator.
struct CountingAllocator;

thread_local! {
    static ALLOCATIONS: Cell<u64> = const { Cell::new(0) };
}

pub(crate) fn allocation_count() -> u64 {
    ALLOCATIONS.with(Cell::get)
}

// SAFETY: every method forwards the caller's layout and pointer unchanged to
// `std::alloc::System`, which upholds the `GlobalAlloc` contract; the only
// extra work is a `const`-initialised thread-local `Cell` increment through
// `try_with`, which neither allocates nor panics, so no method recurses into
// the allocator or unwinds.
unsafe impl std::alloc::GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        count_allocation();
        // SAFETY: `layout` is the caller's, which `GlobalAlloc::alloc` requires
        // to have a non-zero size; it reaches `System` unchanged.
        unsafe { std::alloc::System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: std::alloc::Layout) {
        // SAFETY: this allocator hands out only `System` blocks, and
        // `GlobalAlloc::dealloc` requires `pointer` to be one of them with this
        // same `layout`.
        unsafe { std::alloc::System.dealloc(pointer, layout) }
    }

    unsafe fn realloc(
        &self,
        pointer: *mut u8,
        layout: std::alloc::Layout,
        new_size: usize,
    ) -> *mut u8 {
        count_allocation();
        // SAFETY: this allocator hands out only `System` blocks, and
        // `GlobalAlloc::realloc` requires `pointer` to be one of them with
        // `layout` and `new_size` to be valid for it; all three reach `System`
        // unchanged.
        unsafe { std::alloc::System.realloc(pointer, layout, new_size) }
    }
}

/// `try_with` rather than `with`: an allocation during thread teardown finds the
/// thread local already destroyed, and panicking there would abort the process.
fn count_allocation() {
    let _ = ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
}

#[global_allocator]
static COUNTING_ALLOCATOR: CountingAllocator = CountingAllocator;
