#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(exit_code) = sourdaw_lib::host::plugin_scan_worker::run_from_process_args() {
        std::process::exit(exit_code);
    }
    sourdaw_lib::run()
}
