//! A bounded structural collector. Oxc resolves lexical bindings; this module
//! resolves only explicit local module exports. It does not run TypeScript's
//! checker, execute code, or infer a namespace's entire export set as ancestry.
use crate::{Component, FileCost, Reference, Relationship, Request, Source, tokens};
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::{GetSpan, SourceType, Span};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component as PathComponent, Path, PathBuf};

#[derive(Clone, Debug)]
enum Target {
    Component(String),
    Import { file: String, name: String },
    Namespace(String),
    External,
}

#[derive(Clone)]
struct Owner {
    id: String,
    span: Span,
}

struct PendingReference {
    owner: String,
    target: Target,
    offset: u32,
    line: u32,
}

struct FileData {
    file: String,
    exports: HashMap<String, Target>,
    references: Vec<PendingReference>,
    actions: Vec<(String, Option<Target>)>,
    imports: Vec<Target>,
}

fn line_at(text: &str, offset: u32) -> u32 {
    // Oxc byte offsets must not be confused with TypeScript UTF-16 offsets.
    // ECMAScript also treats CR and Unicode separators as line terminators.
    let mut line = 1;
    let mut previous_cr = false;
    for character in text[..offset as usize].chars() {
        match character {
            '\n' if previous_cr => {}
            '\n' | '\r' | '\u{2028}' | '\u{2029}' => line += 1,
            _ => {}
        }
        previous_cr = character == '\r';
    }
    line
}

fn utf16_at(text: &str, offset: u32) -> usize {
    text[..offset as usize].encode_utf16().count()
}

fn script(file: &str) -> bool {
    file.ends_with(".ts") || file.ends_with(".mts") || file.ends_with(".cts")
}

fn source_language(file: &str) -> bool {
    [
        ".js", ".jsx", ".mjs", ".cjs", ".tsx", ".mtsx", ".ctsx", ".rs",
    ]
    .iter()
    .any(|extension| file.ends_with(extension))
}

fn test_file(file: &str) -> bool {
    file.split('/')
        .any(|part| part == "test" || part == "tests")
        || file.contains(".test.")
        || file.contains(".spec.")
}

fn normalized(path: &Path) -> Option<PathBuf> {
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            PathComponent::Normal(part) => result.push(part),
            PathComponent::CurDir => {}
            PathComponent::ParentDir => {
                if !result.pop() {
                    return None;
                }
            }
            _ => return None,
        }
    }
    Some(result)
}

fn checked_file(root: &Path, file: &str) -> Result<PathBuf, String> {
    let relative = normalized(Path::new(file))
        .filter(|relative| !relative.as_os_str().is_empty())
        .ok_or_else(|| format!("Maintained path escapes root: {file}"))?;
    if relative.to_string_lossy().replace('\\', "/") != file {
        return Err(format!(
            "Maintained file must be a normalized relative path: {file}"
        ));
    }
    let mut absolute = root.to_path_buf();
    for part in relative.components() {
        absolute.push(part);
        let metadata = fs::symlink_metadata(&absolute)
            .map_err(|error| format!("Cannot inspect {file}: {error}"))?;
        if metadata.is_symlink() {
            return Err(format!("Symlinks are unsupported: {file}"));
        }
    }
    let absolute =
        fs::canonicalize(&absolute).map_err(|error| format!("Cannot resolve {file}: {error}"))?;
    if !absolute.starts_with(root) || !absolute.is_file() {
        return Err(format!(
            "Maintained path escapes root or is not a file: {file}"
        ));
    }
    Ok(absolute)
}

fn module_target(
    from: &str,
    specifier: &str,
    root: &Path,
    inventory: &HashSet<String>,
    problems: &mut Vec<String>,
) -> Option<String> {
    if !specifier.starts_with('.') {
        if specifier.starts_with('/') || specifier.starts_with("file:") {
            problems.push(format!(
                "Unsupported absolute module specifier: {from}: {specifier}"
            ));
        } else if !specifier.starts_with("node:") {
            // Without TypeScript/package resolution a bare specifier could be
            // an external package, a workspace package, or a tsconfig alias.
            // Treating all three as unmeasured externals could lose ancestry.
            problems.push(format!(
                "Unsupported package or alias resolution: {from}: {specifier}"
            ));
        }
        return None;
    }
    let path = Path::new(from)
        .parent()
        .unwrap_or(Path::new(""))
        .join(specifier);
    let Some(path) = normalized(&path) else {
        problems.push(format!(
            "Local dependency escapes root: {from}: {specifier}"
        ));
        return None;
    };
    let mut candidates = vec![path.clone()];
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("js") => candidates.push(path.with_extension("ts")),
        Some("mjs") => candidates.push(path.with_extension("mts")),
        Some("cjs") => candidates.push(path.with_extension("cts")),
        None => {
            candidates.extend([
                path.with_extension("ts"),
                path.with_extension("mts"),
                path.with_extension("cts"),
            ]);
            candidates.push(path.join("index.ts"));
        }
        _ => {}
    }
    for candidate in candidates {
        let file = candidate.to_string_lossy().replace('\\', "/");
        if root.join(&candidate).is_file() {
            if !inventory.contains(&file) {
                problems.push(format!(
                    "Local dependency outside maintained inventory: {file}"
                ));
                return None;
            }
            if let Err(error) = checked_file(root, &file) {
                problems.push(error);
                return None;
            }
            if !script(&file) {
                problems.push(format!("Unsupported local module language: {file}"));
                return None;
            }
            return Some(file);
        }
    }
    problems.push(format!("Cannot resolve local module: {from}: {specifier}"));
    None
}

fn symbol(binding: &BindingIdentifier<'_>) -> Option<usize> {
    binding.symbol_id.get().map(|id| id.index())
}

fn reference_symbol(
    identifier: &IdentifierReference<'_>,
    semantic: &Semantic<'_>,
) -> Option<usize> {
    identifier.reference_id.get().and_then(|id| {
        semantic
            .scoping()
            .get_reference(id)
            .symbol_id()
            .map(|symbol| symbol.index())
    })
}

fn add_component(
    source: &mut Source,
    owners: &mut Vec<Owner>,
    symbols: &mut HashMap<usize, Target>,
    file: &str,
    bindings: &str,
    text: &str,
    span: Span,
    binding: Option<&BindingIdentifier<'_>>,
    name: Option<String>,
) -> Option<String> {
    let name = name.unwrap_or_else(|| format!("<top-level:{}>", utf16_at(text, span.start)));
    let id = format!("{file}#{name}");
    let tokens = match tokens::count(&text[span.start as usize..span.end as usize], true) {
        Ok(tokens) => tokens,
        Err(error) => {
            source
                .problems
                .push(format!("Unsupported token metric: {id}: {error}"));
            return None;
        }
    };
    if source.components.iter().any(|component| component.id == id) {
        source.problems.push(format!(
            "Duplicate or overloaded component requires an adapter: {id}"
        ));
    }
    source.components.push(Component {
        file: file.to_string(),
        line: line_at(text, span.start),
        id: id.clone(),
        name,
        kind: if file == bindings {
            "binding"
        } else if test_file(file) {
            "test"
        } else {
            "production"
        }
        .to_string(),
        tokens,
    });
    owners.push(Owner {
        id: id.clone(),
        span,
    });
    if let Some(symbol) = binding.and_then(symbol) {
        symbols.insert(symbol, Target::Component(id.clone()));
    }
    Some(id)
}

#[allow(clippy::too_many_arguments)]
fn declaration(
    declaration: &Declaration<'_>,
    export_span: Option<Span>,
    source: &mut Source,
    owners: &mut Vec<Owner>,
    symbols: &mut HashMap<usize, Target>,
    exports: &mut HashMap<String, Target>,
    file: &str,
    bindings: &str,
    text: &str,
) {
    macro_rules! add {
        ($span:expr, $binding:expr, $name:expr) => {{
            let binding: Option<&BindingIdentifier<'_>> = $binding;
            let id = add_component(
                source, owners, symbols, file, bindings, text, $span, binding, $name,
            );
            if export_span.is_some() {
                if let (Some(binding), Some(id)) = (binding, &id) {
                    exports.insert(binding.name.to_string(), Target::Component(id.clone()));
                }
            }
            id
        }};
    }
    match declaration {
        Declaration::VariableDeclaration(variable) => {
            for item in &variable.declarations {
                match &item.id {
                    BindingPattern::BindingIdentifier(binding) => {
                        let id = add!(item.span, Some(binding), Some(binding.name.to_string()));
                        if file == bindings && binding.name == "actions" {
                            source.registry = id;
                            if export_span.is_none()
                                || variable.kind != VariableDeclarationKind::Const
                                || !matches!(item.init, Some(Expression::ObjectExpression(_)))
                            {
                                source.problems.push("Bindings must export const actions = { \"action\": namedHandler }".to_string());
                            }
                        }
                    }
                    pattern => {
                        let span = pattern.span();
                        let name = text[span.start as usize..span.end as usize].to_string();
                        let id = add!(item.span, None, Some(name));
                        if let Some(id) = id {
                            source
                                .problems
                                .push(format!("Unsupported declaration: {id}"));
                        }
                    }
                }
            }
        }
        Declaration::FunctionDeclaration(function) => {
            add!(
                export_span.unwrap_or(function.span),
                function.id.as_ref(),
                function.id.as_ref().map(|binding| binding.name.to_string())
            );
        }
        Declaration::ClassDeclaration(class) => {
            add!(
                export_span.unwrap_or(class.span),
                class.id.as_ref(),
                class.id.as_ref().map(|binding| binding.name.to_string())
            );
        }
        Declaration::TSTypeAliasDeclaration(alias) => {
            add!(
                export_span.unwrap_or(alias.span),
                Some(&alias.id),
                Some(alias.id.name.to_string())
            );
        }
        Declaration::TSInterfaceDeclaration(interface) => {
            add!(
                export_span.unwrap_or(interface.span),
                Some(&interface.id),
                Some(interface.id.name.to_string())
            );
        }
        _ => {
            let span = export_span.unwrap_or_else(|| declaration.span());
            source.problems.push(format!(
                "Unsupported declaration: {file}:{}",
                line_at(text, span.start)
            ));
        }
    }
}

struct ExtraReferences<'s, 'a> {
    semantic: &'s Semantic<'a>,
    symbols: &'s HashMap<usize, Target>,
    owners: &'s [Owner],
    file: &'s str,
    text: &'s str,
    references: Vec<PendingReference>,
    namespace_selections: HashSet<u32>,
    shorthand_values: HashSet<u32>,
    problems: Vec<String>,
}

impl ExtraReferences<'_, '_> {
    fn owner(&self, offset: u32) -> Option<&Owner> {
        self.owners
            .iter()
            .find(|owner| owner.span.start <= offset && offset < owner.span.end)
    }

    fn namespace(&self, expression: &Expression<'_>) -> Option<String> {
        let Expression::Identifier(identifier) = expression else {
            return None;
        };
        let symbol = reference_symbol(identifier, self.semantic)?;
        match self.symbols.get(&symbol) {
            Some(Target::Namespace(file)) => Some(file.clone()),
            _ => None,
        }
    }

    fn selection(
        &mut self,
        object: &Expression<'_>,
        name: Option<String>,
        span: Span,
        offset: u32,
    ) {
        let Some(file) = self.namespace(object) else {
            return;
        };
        self.namespace_selections.insert(object.span().start);
        let Some(owner) = self.owner(span.start) else {
            return;
        };
        if let Some(name) = name {
            self.references.push(PendingReference {
                owner: owner.id.clone(),
                target: Target::Import { file, name },
                offset,
                line: line_at(self.text, offset),
            });
        } else {
            self.problems.push(format!(
                "Unsupported dynamic import selection: {} at {}:{}",
                owner.id,
                self.file,
                line_at(self.text, span.start)
            ));
        }
    }
}

impl<'a> Visit<'a> for ExtraReferences<'_, 'a> {
    fn visit_assignment_target_property_identifier(
        &mut self,
        property: &AssignmentTargetPropertyIdentifier<'a>,
    ) {
        // TypeScript exposes a shorthand property symbol here as well, even
        // though this occurrence writes the existing value binding.
        self.shorthand_values.insert(property.binding.span.start);
        walk::walk_assignment_target_property_identifier(self, property);
    }

    fn visit_decorator(&mut self, decorator: &Decorator<'a>) {
        // Oxc's export wrapper can start after a leading class decorator;
        // until component boundaries cover that syntax exactly, do not claim
        // complete costs or ancestry for decorated declarations.
        self.problems.push(format!(
            "Unsupported decorator: {}:{}",
            self.file,
            line_at(self.text, decorator.span.start)
        ));
        walk::walk_decorator(self, decorator);
    }

    fn visit_object_property(&mut self, property: &ObjectProperty<'a>) {
        // The reference engine asks TypeScript for the symbol at every
        // identifier. A shorthand property names its property symbol, not the
        // value symbol, so that occurrence does not link to a top-level value.
        if property.shorthand {
            if let Expression::Identifier(identifier) = &property.value {
                self.shorthand_values.insert(identifier.span.start);
            }
        }
        walk::walk_object_property(self, property);
    }

    fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
        self.selection(
            &member.object,
            Some(member.property.name.to_string()),
            member.span,
            member.property.span.start,
        );
        walk::walk_static_member_expression(self, member);
    }

    fn visit_computed_member_expression(&mut self, member: &ComputedMemberExpression<'a>) {
        let name = match &member.expression {
            Expression::StringLiteral(literal) => literal.value.as_str().map(str::to_string),
            _ => None,
        };
        self.selection(&member.object, name, member.span, member.span.start);
        walk::walk_computed_member_expression(self, member);
    }

    fn visit_import_expression(&mut self, import: &ImportExpression<'a>) {
        if let Some(owner) = self.owner(import.span.start) {
            self.problems.push(format!(
                "Dynamic import requires an adapter: {} at {}:{}",
                owner.id,
                self.file,
                line_at(self.text, import.span.start)
            ));
        }
        walk::walk_import_expression(self, import);
    }

    fn visit_ts_import_type(&mut self, import: &TSImportType<'a>) {
        self.problems.push(format!(
            "Unsupported import type: {}:{}",
            self.file,
            line_at(self.text, import.span.start)
        ));
        walk::walk_ts_import_type(self, import);
    }
}

fn parse_file(
    request: &Request,
    source: &mut Source,
    root: &Path,
    inventory: &HashSet<String>,
    file: &str,
    text: &str,
) -> Option<FileData> {
    let allocator = Allocator::default();
    let source_type = match SourceType::from_path(file) {
        Ok(source_type) => source_type,
        Err(error) => {
            source
                .problems
                .push(format!("Unsupported script path: {file}: {error}"));
            return None;
        }
    };
    let parsed = Parser::new(&allocator, text, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        for diagnostic in parsed.diagnostics {
            source
                .problems
                .push(format!("Parse error: {file}: {diagnostic}"));
        }
        return None;
    }
    if source_type.is_typescript_definition()
        && !parsed
            .program
            .body
            .iter()
            .any(Statement::is_module_declaration)
    {
        // Ambient scripts share compiler-wide global symbols. A per-file
        // semantic model cannot resolve consumers in other source files.
        source
            .problems
            .push(format!("Unsupported ambient declaration scope: {file}"));
    }
    let built = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !built.diagnostics.is_empty() {
        for diagnostic in built.diagnostics {
            source
                .problems
                .push(format!("Semantic binding error: {file}: {diagnostic}"));
        }
        return None;
    }
    let semantic = built.semantic;
    let mut symbols = HashMap::new();
    let mut owners = Vec::new();
    let mut exports = HashMap::new();
    let mut imports = Vec::new();
    let mut action_declarations = Vec::new();
    for directive in &parsed.program.directives {
        add_component(
            source,
            &mut owners,
            &mut symbols,
            file,
            &request.bindings,
            text,
            directive.span,
            None,
            None,
        );
    }
    for statement in &parsed.program.body {
        match statement {
            Statement::ImportDeclaration(import) => imports.push(import),
            Statement::ExportDeclaration(export) => {
                declaration(
                    &export.declaration,
                    Some(export.span),
                    source,
                    &mut owners,
                    &mut symbols,
                    &mut exports,
                    file,
                    &request.bindings,
                    text,
                );
                if let Declaration::VariableDeclaration(variable) = &export.declaration {
                    action_declarations.push((variable, true));
                }
            }
            Statement::ExportNamedDeclaration(_)
            | Statement::ExportFromDeclaration(_)
            | Statement::ExportAllDeclaration(_)
            | Statement::ExportDefaultDeclaration(_)
            | Statement::TSExportAssignment(_)
            | Statement::TSNamespaceExportDeclaration(_) => {
                source.problems.push(format!(
                    "Unsupported export form: {file}:{}",
                    line_at(text, statement.span().start)
                ));
            }
            _ => {
                if let Some(item) = statement.as_declaration() {
                    declaration(
                        item,
                        None,
                        source,
                        &mut owners,
                        &mut symbols,
                        &mut exports,
                        file,
                        &request.bindings,
                        text,
                    );
                    if let Declaration::VariableDeclaration(variable) = item {
                        action_declarations.push((variable, false));
                    }
                } else {
                    add_component(
                        source,
                        &mut owners,
                        &mut symbols,
                        file,
                        &request.bindings,
                        text,
                        statement.span(),
                        None,
                        None,
                    );
                }
            }
        }
    }
    for import in imports {
        let module = match import.source.value.as_str() {
            Some(specifier) => {
                module_target(file, specifier, root, inventory, &mut source.problems)
            }
            None => {
                source
                    .problems
                    .push(format!("Unsupported module string: {file}"));
                None
            }
        };
        if let Some(specifiers) = &import.specifiers {
            for specifier in specifiers {
                let (binding, target) = match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(import) => (
                        &import.local,
                        module
                            .as_ref()
                            .map(|file| Target::Import {
                                file: file.clone(),
                                name: import.imported.name().to_string(),
                            })
                            .unwrap_or(Target::External),
                    ),
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(import) => (
                        &import.local,
                        module
                            .as_ref()
                            .map(|file| Target::Import {
                                file: file.clone(),
                                name: "default".to_string(),
                            })
                            .unwrap_or(Target::External),
                    ),
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(import) => (
                        &import.local,
                        module
                            .as_ref()
                            .map(|file| Target::Namespace(file.clone()))
                            .unwrap_or(Target::External),
                    ),
                };
                if let Some(symbol) = symbol(binding) {
                    symbols.insert(symbol, target);
                }
            }
        }
    }
    let mut actions = Vec::new();
    if file == request.bindings {
        for (variable, exported) in action_declarations {
            for item in &variable.declarations {
                let BindingPattern::BindingIdentifier(binding) = &item.id else {
                    continue;
                };
                if binding.name != "actions"
                    || !exported
                    || variable.kind != VariableDeclarationKind::Const
                {
                    continue;
                }
                let Some(Expression::ObjectExpression(object)) = &item.init else {
                    continue;
                };
                for property in &object.properties {
                    let ObjectPropertyKind::ObjectProperty(property) = property else {
                        source.problems.push(
                            "Each action binding must be a literal key and named handler"
                                .to_string(),
                        );
                        continue;
                    };
                    let key = if !property.computed && !property.method && !property.shorthand {
                        match &property.key {
                            PropertyKey::StaticIdentifier(identifier) => {
                                Some(identifier.name.to_string())
                            }
                            PropertyKey::StringLiteral(literal) => {
                                literal.value.as_str().map(str::to_string)
                            }
                            _ => None,
                        }
                    } else {
                        None
                    };
                    let Expression::Identifier(identifier) = &property.value else {
                        source.problems.push(
                            "Each action binding must be a literal key and named handler"
                                .to_string(),
                        );
                        continue;
                    };
                    if let Some(key) = key {
                        let target = reference_symbol(identifier, &semantic)
                            .and_then(|symbol| symbols.get(&symbol))
                            .cloned();
                        actions.push((key, target));
                    } else {
                        source.problems.push(
                            "Each action binding must be a literal key and named handler"
                                .to_string(),
                        );
                    }
                }
            }
        }
    }
    let mut extra = ExtraReferences {
        semantic: &semantic,
        symbols: &symbols,
        owners: &owners,
        file,
        text,
        references: Vec::new(),
        namespace_selections: HashSet::new(),
        shorthand_values: HashSet::new(),
        problems: Vec::new(),
    };
    extra.visit_program(&parsed.program);
    for symbol in semantic.scoping().symbol_ids() {
        let Some(target) = symbols.get(&symbol.index()) else {
            continue;
        };
        for reference in semantic.symbol_references(symbol) {
            let span = semantic.reference_span(reference);
            if extra.shorthand_values.contains(&span.start) {
                continue;
            }
            let Some(owner) = owners
                .iter()
                .find(|owner| owner.span.start <= span.start && span.start < owner.span.end)
            else {
                continue;
            };
            if matches!(target, Target::Namespace(_)) {
                if !extra.namespace_selections.contains(&span.start) {
                    extra.problems.push(format!(
                        "Unsupported namespace escape: {} at {file}:{}",
                        owner.id,
                        line_at(text, span.start)
                    ));
                }
                continue;
            }
            extra.references.push(PendingReference {
                owner: owner.id.clone(),
                target: target.clone(),
                offset: span.start,
                line: line_at(text, span.start),
            });
        }
    }
    extra.references.sort_by_key(|reference| reference.offset);
    source.problems.extend(extra.problems);
    let imports = symbols
        .values()
        .filter(|target| matches!(target, Target::Import { .. }))
        .cloned()
        .collect();
    Some(FileData {
        file: file.to_string(),
        exports,
        references: extra.references,
        actions,
        imports,
    })
}

fn resolve_target(
    target: &Target,
    files: &HashMap<String, &FileData>,
    visiting: &mut HashSet<(String, String)>,
) -> Result<Option<String>, String> {
    match target {
        Target::Component(id) => Ok(Some(id.clone())),
        Target::External => Ok(None),
        Target::Namespace(file) => Err(format!("Unsupported namespace value: {file}")),
        Target::Import { file, name } => {
            let key = (file.clone(), name.clone());
            if !visiting.insert(key.clone()) {
                return Err(format!("Unresolved circular module export: {file}#{name}"));
            }
            let target = files
                .get(file)
                .and_then(|file| file.exports.get(name))
                .ok_or_else(|| format!("Cannot resolve local export: {file}#{name}"))?;
            let result = resolve_target(target, files, visiting);
            visiting.remove(&key);
            result
        }
    }
}

pub fn collect(request: &Request) -> Result<Source, String> {
    if request.protocol != 1 {
        return Err("Unsupported collector protocol".to_string());
    }
    let root = fs::canonicalize(&request.root)
        .map_err(|error| format!("Cannot resolve project root: {error}"))?;
    if !root.is_dir() {
        return Err("Project root is not a directory".to_string());
    }
    let inventory: HashSet<String> = request.files.iter().cloned().collect();
    if inventory.len() != request.files.len() {
        return Err("Duplicate maintained file".to_string());
    }
    let mut source = Source::default();
    let mut parsed = Vec::new();
    for file in &request.files {
        let path = checked_file(&root, file)?;
        let text =
            fs::read_to_string(path).map_err(|error| format!("Cannot read {file}: {error}"))?;
        let typescript = script(file);
        match tokens::count(&text, typescript) {
            Ok(tokens) => source.files.push(FileCost {
                file: file.clone(),
                tokens,
            }),
            Err(error) => {
                source
                    .problems
                    .push(format!("Unsupported token metric: {file}: {error}"));
                continue;
            }
        }
        if source_language(file) {
            source
                .problems
                .push(format!("Unsupported source language: {file}"));
        }
        if typescript {
            if let Some(file) = parse_file(request, &mut source, &root, &inventory, file, &text) {
                parsed.push(file);
            }
        }
    }
    let files: HashMap<String, &FileData> = parsed
        .iter()
        .map(|file| (file.file.clone(), file))
        .collect();
    let kinds: HashMap<String, String> = source
        .components
        .iter()
        .map(|component| (component.id.clone(), component.kind.clone()))
        .collect();
    let mut seen = HashSet::new();
    for file in &parsed {
        // An unused import can still name a missing export. Resolving only
        // referenced imports would falsely claim complete module resolution.
        for target in &file.imports {
            if let Err(error) = resolve_target(target, &files, &mut HashSet::new()) {
                source.problems.push(error);
            }
        }
        for reference in &file.references {
            match resolve_target(&reference.target, &files, &mut HashSet::new()) {
                Ok(Some(target))
                    if target != reference.owner
                        && seen.insert((reference.owner.clone(), target.clone())) =>
                {
                    source.relationships.push(Relationship {
                        from: reference.owner.clone(),
                        to: target,
                        kind: "reference".to_string(),
                        origin: "static".to_string(),
                        source_ref: Reference {
                            file: file.file.clone(),
                            line: reference.line,
                        },
                    });
                }
                Err(error) => source.problems.push(error),
                _ => {}
            }
        }
        for (key, target) in &file.actions {
            let resolved = target
                .as_ref()
                .map(|target| resolve_target(target, &files, &mut HashSet::new()));
            match resolved {
                Some(Ok(Some(target)))
                    if kinds.get(&target).is_some_and(|kind| kind == "production") =>
                {
                    if source.actions.contains_key(key) {
                        source.problems.push(format!("Duplicate action: {key}"));
                    } else {
                        source.actions.insert(key.clone(), target);
                    }
                }
                _ => source
                    .problems
                    .push(format!("Cannot resolve action handler: {key}")),
            }
        }
    }
    if source.registry.is_none() {
        source
            .problems
            .push("No exported actions registry found".to_string())
    }
    // Repeated unresolved references should not turn one actionable problem into
    // hundreds of identical messages.
    let mut seen = HashSet::new();
    source
        .problems
        .retain(|problem| seen.insert(problem.clone()));
    Ok(source)
}
