#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        reason = "tests assert by unwrapping and fail by panicking"
    )
)]

pub mod audio_decode;

pub use audio_decode::{
    decode_audio_file, decode_audio_file_bytes, decode_audio_file_bytes_interleaved, DecodedAudio,
    InterleavedAudio,
};
