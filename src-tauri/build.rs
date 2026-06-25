fn main() {
    // Force the build script to re-run when frontend files change
    println!("cargo:rerun-if-changed=../public/");
    tauri_build::build()
}
