use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub mod collector;
pub mod tokens;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol: u32,
    pub root: String,
    pub files: Vec<String>,
    pub bindings: String,
}

#[derive(Default, Serialize)]
pub struct Source {
    pub files: Vec<FileCost>,
    pub components: Vec<Component>,
    pub relationships: Vec<Relationship>,
    pub actions: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<String>,
    pub problems: Vec<String>,
}

#[derive(Serialize)]
pub struct FileCost {
    pub file: String,
    pub tokens: u64,
}

#[derive(Clone, Serialize)]
pub struct Component {
    pub file: String,
    pub line: u32,
    pub id: String,
    pub name: String,
    pub kind: String,
    pub tokens: u64,
}

#[derive(Serialize)]
pub struct Reference {
    pub file: String,
    pub line: u32,
}

#[derive(Serialize)]
pub struct Relationship {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub origin: String,
    #[serde(rename = "sourceRef")]
    pub source_ref: Reference,
}
