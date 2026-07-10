use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let path = match args.get(1) {
        Some(p) => p,
        None => {
            eprintln!("usage: muster-parse <catalogue-file>");
            return ExitCode::from(1);
        }
    };
    // Default 10s deadline (spec §10.1 "max parse time").
    match engine_parser::parse_file(std::path::Path::new(path), Some(std::time::Duration::from_secs(10))) {
        Ok((ir, diags)) => {
            for d in &diags {
                eprintln!("diagnostic[{}]: {}", d.code, d.message);
            }
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
