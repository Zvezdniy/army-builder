use std::path::Path;
use std::process::ExitCode;
use std::time::Duration;

/// CLI: `muster-parse <primary.cat> [supporting.gst ...]`
/// With no supporting files it parses one catalogue; with supporting files it
/// assembles the primary `.cat` together with its `.gst`/library files.
fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let primary = match args.get(1) {
        Some(p) => p,
        None => {
            eprintln!("usage: muster-parse <catalogue-file> [supporting-file ...]");
            return ExitCode::from(1);
        }
    };
    let supporting: Vec<&Path> = args[2..].iter().map(|s| Path::new(s.as_str())).collect();
    // Real 3–4 MB systems take longer than a single small catalogue; give room.
    let deadline = Some(Duration::from_secs(30));

    let result = if supporting.is_empty() {
        engine_parser::parse_file(Path::new(primary), deadline)
    } else {
        engine_parser::parse_system_files(Path::new(primary), &supporting, deadline)
    };

    match result {
        Ok((ir, diags)) => {
            for d in &diags {
                eprintln!("diagnostic[{}]: {}", d.code, d.message);
            }
            eprintln!("diagnostics: {}", diags.len());
            match serde_json::to_string_pretty(&ir) {
                Ok(json) => {
                    println!("{json}");
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("serialize error: {e}");
                    ExitCode::from(2)
                }
            }
        }
        Err(e) => {
            eprintln!("parse error: {e}");
            ExitCode::from(2)
        }
    }
}
