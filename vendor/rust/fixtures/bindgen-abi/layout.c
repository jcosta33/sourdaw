#include <stddef.h>
#include "whisper.h"

#if defined(_MSC_VER)
#define FIXTURE_ALIGNOF(T) __alignof(T)
#else
#define FIXTURE_ALIGNOF(T) _Alignof(T)
#endif

size_t fixture_context_size(void) { return sizeof(struct whisper_context_params); }
size_t fixture_context_align(void) { return FIXTURE_ALIGNOF(struct whisper_context_params); }
size_t fixture_context_gpu_offset(void) { return offsetof(struct whisper_context_params, gpu_device); }
size_t fixture_context_memory_offset(void) { return offsetof(struct whisper_context_params, dtw_mem_size); }
size_t fixture_token_size(void) { return sizeof(whisper_token_data); }
size_t fixture_token_align(void) { return FIXTURE_ALIGNOF(whisper_token_data); }
size_t fixture_token_t0_offset(void) { return offsetof(whisper_token_data, t0); }
size_t fixture_token_dtw_offset(void) { return offsetof(whisper_token_data, t_dtw); }
bool fixture_call_encoder_begin(whisper_encoder_begin_callback callback, void * user_data) {
    return callback(NULL, NULL, user_data);
}
