#[cfg(test)]
mod tests {
    use daw_plugin_host::ClapWrapper;
    #[test]
    fn actual_loader_releases_failed_entries_before_unloading_their_library() {
        let root = std::env::temp_dir().join(format!(
            "sourdaw-loader-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        std::fs::create_dir(&root).expect("fixture directory");
        for (name, source, error, events) in [
            (
                "accepted",
                env!("FIXTURE_ACCEPTED"),
                "Plugin factory is null",
                "init\nget_factory\ndeinit\nunload\n",
            ),
            (
                "refused",
                env!("FIXTURE_REFUSED"),
                "clap_entry.init() returned false",
                "init\nunload\n",
            ),
        ] {
            let library = root.join(format!("{name}.clap"));
            std::fs::copy(source, &library).expect("copy real dynamic library");
            let result = ClapWrapper::new(
                library.to_str().expect("fixture UTF-8 path"),
                "org.sourdaw.fixture",
                48_000.0,
            );
            assert_eq!(
                result
                    .err()
                    .expect("deliberately missing factory must refuse"),
                error
            );
            let recorded = std::fs::read_to_string(root.join(format!("{name}.clap.log")))
                .expect("C lifecycle events");
            assert_eq!(
                recorded, events,
                "entry cleanup must finish before the real loader unloads its image"
            );
        }
        std::fs::remove_dir_all(root).expect("remove owned fixture directory");
    }
}
