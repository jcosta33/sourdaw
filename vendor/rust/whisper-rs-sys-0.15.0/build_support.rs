use std::path::Path;

pub fn refresh_source_tree(source: &Path, output: &Path) -> fs_extra::error::Result<()> {
    let destination = output.join("whisper.cpp");
    if destination.exists() {
        fs_extra::dir::remove(&destination)?;
    }
    std::fs::create_dir_all(&destination)?;
    fs_extra::dir::copy(source, output, &Default::default())?;
    Ok(())
}
