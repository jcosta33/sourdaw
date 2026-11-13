/* Entry layout/signatures: clap-sys 0.5.0 src/entry.rs and src/version.rs.
 * This bounded library deliberately has no factory and performs no audio work. */
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
static char log_path[4096];
static void record(const char *event) {
    FILE *log = fopen(log_path, "a");
    if (log) { fputs(event, log); fputc('\n', log); fclose(log); }
}
static bool init(const char *path) {
    if (snprintf(log_path, sizeof(log_path), "%s.log", path) >= (int)sizeof(log_path)) return false;
    record("init"); return INIT_ACCEPT;
}
static void deinit(void) { record("deinit"); }
static const void *get_factory(const char *id) { (void)id; record("get_factory"); return NULL; }
struct clap_version { uint32_t major, minor, revision; };
struct clap_plugin_entry {
    struct clap_version clap_version;
    bool (*init)(const char *path);
    void (*deinit)(void);
    const void *(*get_factory)(const char *id);
};
__attribute__((visibility("default"))) const struct clap_plugin_entry clap_entry = { {1, 2, 2}, init, deinit, get_factory };
__attribute__((destructor)) static void unloaded(void) { record("unload"); }
