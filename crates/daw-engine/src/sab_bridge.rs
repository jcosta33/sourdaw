//! SharedArrayBuffer bridge — zero-copy audio transfer between
//! an AudioWorkletProcessor (JS) and the native cpal audio thread (Rust).
//!
//! Layout (per plugin, 2052 bytes):
//!   [0..4)     Int32  control word (atomic: 0=idle, 1=input_ready, 2=output_ready)
//!   [4..516)   f32×128  input left
//!   [516..1028) f32×128  input right
//!   [1028..1540) f32×128  output left
//!   [1540..2052) f32×128  output right

use std::sync::atomic::{AtomicI32, Ordering};

const BLOCK_SIZE: usize = 128;
const CONTROL_OFFSET: usize = 0;
const INPUT_L_OFFSET: usize = 4;
const INPUT_R_OFFSET: usize = 516;
const OUTPUT_L_OFFSET: usize = 1028;
const OUTPUT_R_OFFSET: usize = 1540;

const STATE_IDLE: i32 = 0;
const STATE_INPUT_READY: i32 = 1;
const STATE_OUTPUT_READY: i32 = 2;

/// A handle to a SharedArrayBuffer region for one plugin instance.
/// The pointer comes from JavaScript — the SAB is allocated in the WebView
/// process which shares address space with Rust in Tauri.
pub struct SabBridge {
    /// Raw pointer to the start of the SharedArrayBuffer.
    ptr: *mut u8,
    /// Plugin ID in the scheduler (for routing).
    pub plugin_id: usize,
}

// SAFETY: The SAB is accessed via atomics for the control word,
// and the audio regions are only written by one side at a time
// (coordinated by the control word state machine).
unsafe impl Send for SabBridge {}
unsafe impl Sync for SabBridge {}

impl SabBridge {
    /// Create a bridge from a raw SAB pointer.
    /// # Safety
    /// `ptr` must point to a valid SharedArrayBuffer of at least 2052 bytes
    /// that remains alive for the lifetime of this bridge.
    pub unsafe fn new(ptr: *mut u8, plugin_id: usize) -> Self {
        Self { ptr, plugin_id }
    }

    /// Check if the worklet has written new input, and if so, read it
    /// into the provided buffers and return true.
    #[inline]
    pub fn try_read_input(&self, left: &mut [f32; BLOCK_SIZE], right: &mut [f32; BLOCK_SIZE]) -> bool {
        let control = self.control_word();
        let state = control.load(Ordering::Acquire);

        if state != STATE_INPUT_READY {
            return false;
        }

        // Read input from SAB
        unsafe {
            let input_l = self.ptr.add(INPUT_L_OFFSET) as *const f32;
            let input_r = self.ptr.add(INPUT_R_OFFSET) as *const f32;
            std::ptr::copy_nonoverlapping(input_l, left.as_mut_ptr(), BLOCK_SIZE);
            std::ptr::copy_nonoverlapping(input_r, right.as_mut_ptr(), BLOCK_SIZE);
        }

        true
    }

    /// Write processed output to the SAB and signal the worklet.
    #[inline]
    pub fn write_output(&self, left: &[f32; BLOCK_SIZE], right: &[f32; BLOCK_SIZE]) {
        unsafe {
            let output_l = self.ptr.add(OUTPUT_L_OFFSET) as *mut f32;
            let output_r = self.ptr.add(OUTPUT_R_OFFSET) as *mut f32;
            std::ptr::copy_nonoverlapping(left.as_ptr(), output_l, BLOCK_SIZE);
            std::ptr::copy_nonoverlapping(right.as_ptr(), output_r, BLOCK_SIZE);
        }

        // Signal output ready
        let control = self.control_word();
        control.store(STATE_OUTPUT_READY, Ordering::Release);
    }

    #[inline]
    fn control_word(&self) -> &AtomicI32 {
        unsafe {
            &*(self.ptr.add(CONTROL_OFFSET) as *const AtomicI32)
        }
    }
}
