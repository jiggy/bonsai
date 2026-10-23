use bonsai_collector_prototype::{Request, collector};
use serde_json::json;
use std::io::{self, BufRead, Write};
use std::time::Instant;

fn main() {
    let input = io::stdin();
    let mut output = io::BufWriter::new(io::stdout().lock());
    for line in input.lock().lines() {
        let started = Instant::now();
        let result = line.map_err(|error| error.to_string()).and_then(|line| {
            let request: Request =
                serde_json::from_str(&line).map_err(|error| error.to_string())?;
            if request.protocol != 1 {
                return Err("Unsupported collector protocol".to_string());
            }
            collector::collect(&request)
        });
        let response = match result {
            Ok(source) => json!({
                "protocol": 1,
                "structuralComplete": source.problems.is_empty(),
                "typescriptDiagnostics": "not-run",
                "source": source,
                "elapsedMs": started.elapsed().as_secs_f64() * 1000.0,
            }),
            Err(error) => json!({"protocol": 1, "error": error}),
        };
        if writeln!(output, "{response}")
            .and_then(|_| output.flush())
            .is_err()
        {
            std::process::exit(1);
        }
    }
}
