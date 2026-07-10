#![forbid(unsafe_code)]

pub mod error;
pub mod limits;

pub use error::{Diagnostic, ParseError};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
