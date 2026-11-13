include!(concat!(env!("OUT_DIR"), "/bindings.rs"));

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicUsize, Ordering};

    extern "C" {
        fn fixture_context_size() -> usize;
        fn fixture_context_align() -> usize;
        fn fixture_context_gpu_offset() -> usize;
        fn fixture_context_memory_offset() -> usize;
        fn fixture_token_size() -> usize;
        fn fixture_token_align() -> usize;
        fn fixture_token_t0_offset() -> usize;
        fn fixture_token_dtw_offset() -> usize;
        fn fixture_call_encoder_begin(
            callback: whisper_encoder_begin_callback,
            user_data: *mut c_void,
        ) -> bool;
    }

    #[test]
    fn context_layout_matches_the_actual_c_header() {
        // These fixture functions inspect only C type layout and touch no pointer payload.
        unsafe {
            assert_eq!(
                std::mem::size_of::<whisper_context_params>(),
                fixture_context_size()
            );
            assert_eq!(
                std::mem::align_of::<whisper_context_params>(),
                fixture_context_align()
            );
            assert_eq!(
                std::mem::offset_of!(whisper_context_params, gpu_device),
                fixture_context_gpu_offset()
            );
            assert_eq!(
                std::mem::offset_of!(whisper_context_params, dtw_mem_size),
                fixture_context_memory_offset()
            );
        }
    }

    #[test]
    fn token_layout_matches_the_actual_c_header() {
        // These fixture functions inspect only C type layout and touch no pointer payload.
        unsafe {
            assert_eq!(
                std::mem::size_of::<whisper_token_data>(),
                fixture_token_size()
            );
            assert_eq!(
                std::mem::align_of::<whisper_token_data>(),
                fixture_token_align()
            );
            assert_eq!(
                std::mem::offset_of!(whisper_token_data, t0),
                fixture_token_t0_offset()
            );
            assert_eq!(
                std::mem::offset_of!(whisper_token_data, t_dtw),
                fixture_token_dtw_offset()
            );
        }
    }

    #[test]
    fn generated_encoder_callback_alias_crosses_the_real_c_abi() {
        static EXPECTED: AtomicUsize = AtomicUsize::new(0);
        static CALLS: AtomicUsize = AtomicUsize::new(0);
        extern "C" fn callback(
            context: *mut whisper_context,
            state: *mut whisper_state,
            data: *mut c_void,
        ) -> bool {
            CALLS.fetch_add(1, Ordering::SeqCst);
            context.is_null() && state.is_null() && data.addr() == EXPECTED.load(Ordering::SeqCst)
        }
        let cookie = 23u8;
        let data = std::ptr::from_ref(&cookie).cast_mut().cast::<c_void>();
        EXPECTED.store(data.addr(), Ordering::SeqCst);
        // C forwards the live cookie pointer without dereferencing or retaining it.
        assert!(unsafe { fixture_call_encoder_begin(Some(callback), data) });
        assert_eq!(CALLS.load(Ordering::SeqCst), 1);
    }
}

#[cfg(test)]
#[path = "../../../whisper-rs-sys-0.15.0/build_support.rs"]
mod build_support;

#[cfg(test)]
mod source_refresh_tests {
    #[test]
    fn source_refresh_replaces_changed_headers_and_removes_deleted_inputs() {
        let root = std::env::temp_dir().join(format!(
            "sourdaw-whisper-refresh-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let source = root.join("source/whisper.cpp");
        let output = root.join("output");
        std::fs::create_dir_all(&source).expect("source directory");
        std::fs::create_dir_all(&output).expect("output directory");
        std::fs::write(source.join("header.h"), "#define VALUE 1\n").expect("original header");
        std::fs::write(source.join("removed.c"), "obsolete source").expect("original source");
        super::build_support::refresh_source_tree(&source, &output).expect("first source copy");
        std::fs::write(source.join("header.h"), "#define VALUE 2\n").expect("changed header");
        std::fs::remove_file(source.join("removed.c")).expect("delete original source");
        super::build_support::refresh_source_tree(&source, &output).expect("refresh existing copy");
        assert_eq!(
            std::fs::read_to_string(output.join("whisper.cpp/header.h")).expect("copied header"),
            "#define VALUE 2\n"
        );
        assert!(
            !output.join("whisper.cpp/removed.c").exists(),
            "deleted source must not survive in the CMake tree"
        );
        std::fs::remove_dir_all(root).expect("remove owned fixture directory");
    }
}
