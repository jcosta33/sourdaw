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

unsafe impl std::alloc::GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        count_allocation();
        unsafe { std::alloc::System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: std::alloc::Layout) {
        unsafe { std::alloc::System.dealloc(pointer, layout) }
    }

    unsafe fn realloc(
        &self,
        pointer: *mut u8,
        layout: std::alloc::Layout,
        new_size: usize,
    ) -> *mut u8 {
        count_allocation();
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
