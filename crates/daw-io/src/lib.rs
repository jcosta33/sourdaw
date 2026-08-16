pub mod audio_decode;

pub use audio_decode::{
    decode_audio_file, decode_audio_file_bytes, decode_audio_file_bytes_interleaved, DecodedAudio,
    InterleavedAudio,
};
