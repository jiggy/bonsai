/** Bounded CPython AST/tokenize adapter; this embedded source is fully charged and checker-hashed. */
export const pythonProgram = String.raw`import ast, asyncio, builtins, codecs, collections, contextlib, hashlib, importlib, importlib.abc, importlib.util, io, json, os, re, sys, sysconfig, tokenize
# Load supported standard modules before admitting a consuming source directory.
STANDARD = set("builtins math json decimal fractions statistics collections functools itertools operator datetime time re string typing asyncio os".split())
# Exact supported exports, rather than every incidental module global.
EXPORTS = {
    "math": set("ceil floor trunc sqrt pow exp log log2 log10 sin cos tan asin acos atan atan2 hypot isfinite isinf isnan fabs factorial gcd lcm pi e tau inf nan".split()),
    "json": {"dumps", "loads"}, "decimal": {"Decimal"}, "fractions": {"Fraction"},
    "statistics": set("mean median mode fmean harmonic_mean geometric_mean pstdev pvariance stdev variance".split()),
    "collections": {"Counter", "defaultdict", "deque"}, "functools": {"reduce"},
    "itertools": set("chain repeat count cycle accumulate islice product permutations combinations zip_longest".split()),
    "operator": set("add sub mul truediv floordiv mod pow eq ne lt le gt ge not_ and_ or_ xor neg pos abs concat contains countOf indexOf".split()),
    "datetime": {"datetime", "datetime.strptime", "date", "time", "timedelta"},
    "time": {"sleep"}, "re": set("match fullmatch search sub subn split findall escape compile".split()),
    "string": set("ascii_letters ascii_lowercase ascii_uppercase digits hexdigits octdigits punctuation whitespace printable".split()),
    "typing": set("Any Optional Union List Dict Tuple Set FrozenSet Sequence Mapping Iterable Literal".split()),
    "asyncio": {"sleep"},
    "os": {"getpid"},
}

def supported_export(name):
    module, _, member = name.partition(".")
    return member in EXPORTS.get(module, set())

def data_export(name):
    return name in {"math.pi", "math.e", "math.tau", "math.inf", "math.nan"} or (name.startswith("string.") and supported_export(name))
for module in sorted(STANDARD):
    importlib.import_module(module)

MAPPING_TYPES = (dict, collections.Counter, collections.defaultdict)

LIBRARY = sysconfig.get_config_var("LDLIBRARY")
LIBDIR = sysconfig.get_config_var("LIBDIR")

def context():
    digest = hashlib.sha256(b"bonsai-python-stdlib-v1\0-I\0-S\0-B\0utf8\0source-only-v1")
    paths = {"interpreter": os.path.realpath(sys.executable)}
    if LIBRARY and LIBDIR:
        configured = os.path.join(LIBDIR, LIBRARY)
        if os.path.isfile(configured):
            paths["libpython:configured"] = configured
    if sys.platform.startswith("linux"):
        try:
            with open("/proc/self/maps", encoding="utf8") as mappings:
                mapped = sorted({line.split()[-1] for line in mappings if "/" in line and "libpython" in line.split()[-1]})
            for index, path in enumerate(mapped):
                if os.path.isfile(path):
                    paths["libpython:mapped:" + str(index)] = path
        except OSError:
            pass
    digest.update(json.dumps([getattr(sys.flags, flag, None) for flag in ("isolated", "ignore_environment", "no_site", "dont_write_bytecode", "utf8_mode", "safe_path")]).encode())
    digest.update(json.dumps([os.environ.get(flag) for flag in ("LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH")]).encode())
    for name, module in sorted(sys.modules.copy().items()):
        path = getattr(module, "__file__", None)
        if path and os.path.isfile(path):
            paths["module:" + name] = path
        cached = getattr(module, "__cached__", None)
        if cached and os.path.isfile(cached):
            paths["cached:" + name] = cached
    for label, path in sorted(paths.items()):
        with open(path, "rb") as source:
            data = source.read()
        digest.update(label.encode() + b"\0" + str(len(data)).encode() + b"\0" + data)
    return {"name": "python", "version": ".".join(map(str, sys.version_info[:3])), "digest": digest.hexdigest()}

encode_json = json.dumps
decode_json = json.loads
protocol_write = sys.stdout.write
protocol_flush = sys.stdout.flush

def transferable(value, depth=0):
    if depth > 128:
        raise ValueError("Selected Python value exceeds transfer depth")
    if type(value) is int and not -(2**53 - 1) <= value <= 2**53 - 1:
        raise ValueError("Selected Python integer exceeds the exact JSON safe integer range")
    if type(value) in MAPPING_TYPES:
        for key, field in value.items():
            if type(key) is not str:
                raise ValueError("Selected Python objects require string keys")
            transferable(field, depth + 1)
    elif type(value) in (list, tuple):
        for field in value:
            transferable(field, depth + 1)

def emit(value):
    protocol_write(encode_json(value, allow_nan=False, separators=(",", ":")) + "\n")
    protocol_flush()

def words(text):
    return len(re.findall(r"\w+|[^\w\s]", text, re.UNICODE))

def source_text(data):
    encoding, _ = tokenize.detect_encoding(io.BytesIO(data).readline)
    if codecs.lookup(encoding).name not in ("utf-8", "utf-8-sig"):
        raise ValueError("Python source requires UTF-8 encoding, not " + encoding)
    return data.decode(encoding)

def cost(text):
    total = 0
    for token in tokenize.generate_tokens(io.StringIO(text).readline):
        name = tokenize.tok_name[token.type]
        if name in ("ENCODING", "ENDMARKER", "INDENT", "DEDENT", "NEWLINE", "NL"):
            continue
        if name.startswith("TSTRING"):
            raise ValueError("template string accounting is not supported")
        if name == "STRING" or name.startswith("FSTRING"):
            total += (len(token.string.encode("utf8")) + 3) // 4
        elif name == "COMMENT":
            total += words(token.string)
        elif name == "ERRORTOKEN" and token.string.strip():
            raise ValueError("unrecognized Python token")
        elif token.string.strip():
            total += 1
    return total

def inert(node):
    if isinstance(node, (ast.Constant, ast.Name)):
        return True
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return all(inert(value) for value in node.elts)
    if isinstance(node, ast.Dict):
        return all(key is not None and inert(key) and inert(value) for key, value in zip(node.keys, node.values))
    return False

def analyze(request):
    root, files, bindings = request["root"], request["files"], request["bindings"]
    problems, components, edges, measured, modules, actions, digests = [], [], [], [], {}, {}, {}
    def problem(file, node, message):
        problems.append(file + ":" + str(getattr(node, "lineno", 1)) + ": " + message)
    def kind(file):
        return "binding" if file == bindings else "test" if re.search(r"(^|/)(test|tests)(/|_)|\.test\.|\.spec\.|(^|/)test_[^/]+\.py$|_test\.py$", file) else "production"
    def edge(file, node, source, target, relation="reference"):
        if source and target and source != target:
            edges.append({"from": source, "to": target, "kind": relation, "origin": "static", "sourceRef": {"file": file, "line": getattr(node, "lineno", 1)}})
    def add(file, node, name, text, generated=False):
        identifier = file + "#" + name
        components.append({"file": file, "line": getattr(node, "lineno", 1), "id": identifier, "name": name, "kind": kind(file), "tokens": 0 if generated else cost(ast.get_source_segment(text, node) or "")})
        return identifier
    module_names = {}
    for file in files:
        path = os.path.join(root, file)
        with open(path, "rb") as source:
            data = source.read()
        if file.endswith(".py"):
            digests[file] = hashlib.sha256(data).hexdigest()
        try:
            text = data.decode("utf8")
        except UnicodeDecodeError:
            problems.append(file + ": binary assets are not supported by this source adapter")
            measured.append({"file": file, "tokens": (len(data) + 3) // 4, "executable": False, "kind": kind(file)})
            continue
        if file.endswith(".py"):
            try:
                text = source_text(data)
                tokens = cost(text)
                tree = ast.parse(text, filename=file)
            except (SyntaxError, ValueError, tokenize.TokenError, IndentationError) as error:
                problems.append(file + ": Python analysis failed: " + str(error))
                measured.append({"file": file, "tokens": max(words(text), (len(data) + 3) // 4), "executable": True, "kind": kind(file)})
                continue
            measured.append({"file": file, "tokens": tokens, "executable": True, "kind": kind(file)})
            init = None if kind(file) == "test" else add(file, tree, "<module>", text, True)
            modules[file] = {"tree": tree, "text": text, "init": init, "names": {}, "imports": {}, "owners": []}
            name = file[:-3].replace("/", ".")
            module_names[name[:-9] if name.endswith(".__init__") else name] = file
        else:
            known = bool(re.search(r"\.(?:[cm]?[jt]sx?|rs|go|java|c|h|cc|cpp|sh|rb|php)$", file))
            measured.append({"file": file, "tokens": words(text), "executable": known, "kind": kind(file)})
            if known:
                problems.append(file + ": mixed executable languages require another source adapter")
    def resolve_module(file, name, level=0):
        if level:
            package = file[:-3].replace("/", ".").split(".")[:-1]
            name = ".".join(package[:len(package) - level + 1] + ([name] if name else []))
        return module_names.get(name)
    for file, module in modules.items():
        tree, text, names, init = module["tree"], module["text"], module["names"], module["init"]
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name in names:
                    problem(file, node, "duplicate or reassigned module name")
                identifier = add(file, node, node.name if node.name not in names else node.name + "@" + str(node.lineno), text)
                names[node.name] = (identifier, "function")
                module["owners"].append((node, identifier))
                if kind(file) != "test":
                    edge(file, node, identifier, init, "module-initialization")
                if node.decorator_list:
                    problem(file, node, "decorators require a source adapter")
                # Defaults and annotations run during module initialization.
                for expression in node.args.defaults + [value for value in node.args.kw_defaults if value] + [arg.annotation for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs + [arg for arg in (node.args.vararg, node.args.kwarg) if arg] if arg.annotation] + ([node.returns] if node.returns else []):
                    module["owners"].append((expression, identifier if inert(expression) else init))
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                module["owners"].append((node, init))
            elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                continue
            else:
                targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
                simple = len(targets) == 1 and isinstance(targets[0], ast.Name)
                name = targets[0].id if simple else "<statement@" + str(node.lineno) + ">"
                identifier = add(file, node, name if name not in names else name + "@" + str(node.lineno), text)
                if simple:
                    if name in names:
                        problem(file, node, "duplicate or reassigned module name")
                    names[name] = (identifier, "value")
                module["owners"].append((node, identifier))
                # Literal registry entries reference callbacks without executing them.
                value = node.value if isinstance(node, (ast.Assign, ast.AnnAssign, ast.Expr)) else None
                eager_annotation = isinstance(node, ast.AnnAssign) and not inert(node.annotation)
                if eager_annotation or (not (file == bindings and name == "actions") and not (value is not None and inert(value))):
                    edge(file, node, init, identifier)
                edge(file, node, identifier, init, "module-initialization")
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Del):
                problem(file, node, "deleting Python names requires a source adapter")
            if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)) and node.id.startswith("__"):
                problem(file, node, "runtime module metadata mutation requires a source adapter")
            if isinstance(node, (ast.ClassDef, ast.Global, ast.Nonlocal, ast.NamedExpr, ast.Yield, ast.YieldFrom, ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp, ast.Match)):
                problem(file, node, "classes, closures, comprehensions, pattern matching, and runtime name mutation require a source adapter")
            if isinstance(node, (ast.Import, ast.ImportFrom)) and node not in tree.body:
                problem(file, node, "conditional and function-local imports require a source adapter")
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node not in tree.body:
                problem(file, node, "nested definitions require a source adapter")
        for node in tree.body:
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            if isinstance(node, ast.Import):
                entries = [(alias.asname or alias.name.split(".")[0], alias.name, None, 0) for alias in node.names]
            else:
                entries = [(alias.asname or alias.name, node.module or "", alias.name, node.level) for alias in node.names]
            for local, imported, member, level in entries:
                if member == "*":
                    problem(file, node, "wildcard imports require a source adapter")
                    continue
                if local.startswith("__"):
                    problem(file, node, "imports cannot overwrite module metadata: " + local)
                if local in module["names"] or local in module["imports"]:
                    problem(file, node, "rebound or duplicate import aliases require a source adapter")
                if isinstance(node, ast.Import) and any("." in alias.name and not alias.asname for alias in node.names):
                    problem(file, node, "unaliased dotted imports require a source adapter")
                if imported == "builtins" or ((imported.startswith("os.") or (imported == "os" and member and member not in EXPORTS["os"]))):
                    problem(file, node, "runtime builtins or operating-system context imports require a source adapter")
                target = resolve_module(file, imported, level)
                if target and member:
                    submodule = resolve_module(file, (imported + "." if imported else "") + member, level)
                    if submodule:
                        if member in modules[target]["names"]:
                            problem(file, node, "ambiguous package member/submodule requires a source adapter")
                        target, member = submodule, None
                if target:
                    if kind(file) in ("production", "binding") and kind(target) == "test":
                        problem(file, node, "production imports of test modules require a source adapter")
                    if imported.split(".")[0] in (set(sys.stdlib_module_names) | set(sys.modules)) and not level:
                        problem(file, node, "owned module shadows a standard module")
                    module["imports"][local] = (target, member)
                    edge(file, node, init, modules[target]["init"], "module-initialization")
                    parts = target.split("/")[:-1]
                    for count in range(1, len(parts) + 1):
                        package = "/".join(parts[:count]) + "/__init__.py"
                        if package not in modules:
                            problem(file, node, "namespace packages or unmeasured package initializers require a source adapter")
                        else:
                            edge(file, node, init, modules[package]["init"], "module-initialization")
                elif not level and imported.split(".")[0] in STANDARD:
                    if (member and not supported_export(imported + "." + member)) or (not member and imported not in EXPORTS):
                        problem(file, node, "unsupported standard-library export: " + imported + ("." + member if member else ""))
                    module["imports"][local] = ("@stdlib", imported + ("." + member if member else ""))
                else:
                    problem(file, node, "import is not a supported standard module or maintained Python module: " + imported)
    # Cyclic imports can expose a module's functions before its bindings exist.
    pending = {file: {target for target, _ in module["imports"].values() if target in modules} for file, module in modules.items()}
    dependents = {file: set() for file in modules}
    for file, targets in pending.items():
        for target in targets:
            dependents[target].add(file)
    ready = [file for file, targets in pending.items() if not targets]
    while ready:
        target = ready.pop()
        for dependent in dependents[target]:
            pending[dependent].discard(target)
            if not pending[dependent]:
                ready.append(dependent)
    for file, targets in pending.items():
        if targets:
            problem(file, modules[file]["tree"], "cyclic module initialization requires a source adapter")
    def resolved(file, name):
        module = modules[file]
        if name in module["names"]:
            return module["names"][name]
        if name in module["imports"]:
            target, member = module["imports"][name]
            if target == "@stdlib":
                return ("@stdlib", member)
            if member is None:
                return ("@module", target)
            return modules[target]["names"].get(member)
        if hasattr(builtins, name):
            return ("@builtin", name)
        if name in ("__name__", "__file__", "__package__"):
            return ("@builtin", name)
        return None
    class LocalNames(ast.NodeVisitor):
        def __init__(self):
            self.names = set()
        def visit_Name(self, node):
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                self.names.add(node.id)
        def visit_ExceptHandler(self, node):
            if node.name:
                self.names.add(node.name)
            self.generic_visit(node)
        def visit_Lambda(self, node):
            pass
    forbidden = {"eval", "exec", "compile", "__import__", "globals", "locals", "getattr", "setattr", "delattr", "vars", "dir", "import_module", "input", "breakpoint", "help"}
    for file, module in modules.items():
        parents = {child: parent for parent in ast.walk(module["tree"]) for child in ast.iter_child_nodes(parent)}
        def annotation_use(node):
            while node in parents:
                parent = parents[node]
                if isinstance(parent, (ast.arg, ast.AnnAssign)) and parent.annotation is node:
                    return True
                if isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef)) and parent.returns is node:
                    return True
                if not (isinstance(parent, (ast.Subscript, ast.Tuple, ast.List)) or (isinstance(parent, ast.BinOp) and isinstance(parent.op, ast.BitOr)) or (isinstance(parent, ast.Attribute) and parent.value is node)):
                    return False
                node = parent
            return False
        def exception_use(node, target):
            if target[0] != "@builtin":
                return False
            value = getattr(builtins, target[1], None)
            if not isinstance(value, type) or not issubclass(value, BaseException):
                return False
            parent = parents.get(node)
            if isinstance(parent, ast.Raise) and (parent.exc is node or parent.cause is node):
                return True
            while isinstance(parents.get(node), ast.Tuple):
                node = parents[node]
            parent = parents.get(node)
            return isinstance(parent, ast.ExceptHandler) and parent.type is node
        statements = {node: index for index, node in enumerate(module["tree"].body)}
        binding_order, binding_targets = {}, set()
        for statement, index in statements.items():
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
                binding_order[statement.name] = index
            elif isinstance(statement, (ast.Assign, ast.AnnAssign)):
                targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
                if len(targets) == 1 and isinstance(targets[0], ast.Name):
                    binding_order[targets[0].id] = index
                    binding_targets.add(targets[0])
                    if isinstance(statement, ast.AnnAssign) and statement.value is None:
                        problem(file, statement, "module annotations without assigned values require a source adapter")
            elif isinstance(statement, (ast.Import, ast.ImportFrom)):
                for alias in statement.names:
                    binding_order[alias.asname or (alias.name.split(".")[0] if isinstance(statement, ast.Import) else alias.name)] = index
        dependencies = {name: set() for name in binding_order}
        for declaration, identifier in module["owners"]:
            function_declaration = isinstance(declaration, (ast.FunctionDef, ast.AsyncFunctionDef))
            if function_declaration:
                locals = LocalNames()
                for statement in declaration.body:
                    locals.visit(statement)
                locals.names.update(arg.arg for arg in declaration.args.posonlyargs + declaration.args.args + declaration.args.kwonlyargs + [arg for arg in (declaration.args.vararg, declaration.args.kwarg) if arg])
                name, body = declaration.name, ast.Module(body=declaration.body, type_ignores=[])
            elif isinstance(declaration, (ast.Assign, ast.AnnAssign)):
                targets = declaration.targets if isinstance(declaration, ast.Assign) else [declaration.target]
                if len(targets) != 1 or not isinstance(targets[0], ast.Name):
                    continue
                name, body, locals = targets[0].id, declaration, LocalNames()
            else:
                continue
            dependencies[name].update(item.id for item in ast.walk(body) if isinstance(item, ast.Name) and isinstance(item.ctx, ast.Load) and item.id in binding_order and item.id not in locals.names)
        changed = True
        while changed:
            changed = False
            for name, references in dependencies.items():
                expanded = set(references)
                for reference in list(references):
                    expanded.update(dependencies[reference])
                if expanded != references:
                    dependencies[name] = expanded
                    changed = True
        def active(name):
            if not function and name in binding_order and binding_order[name] >= current_order:
                return ("@builtin", name) if hasattr(builtins, name) else None
            return resolved(file, name)
        def qualified(node, locals):
            if isinstance(node, ast.Name) and node.id not in locals:
                target = active(node.id)
                return target[1] if target and target[0] == "@stdlib" else None
            if isinstance(node, ast.Attribute):
                base = qualified(node.value, locals)
                return base + "." + node.attr if base else None
            return None
        for node, owner in module["owners"]:
            function = isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            top = node
            while parents.get(top) is not module["tree"] and top in parents:
                top = parents[top]
            current_order = statements.get(top, len(statements))
            expression = node.value if isinstance(node, (ast.Assign, ast.AnnAssign, ast.Expr)) else node
            eager = expression is None or not inert(expression) or (isinstance(node, ast.AnnAssign) and not inert(node.annotation))
            local = LocalNames()
            if function:
                for statement in node.body:
                    local.visit(statement)
                local.names.update(arg.arg for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs)
                local.names.update(arg.arg for arg in (node.args.vararg, node.args.kwarg) if arg)
                visit = ast.Module(body=node.body, type_ignores=[])
            else:
                visit = node
            for item in ast.walk(visit):
                if not function and isinstance(item, ast.Name) and isinstance(item.ctx, ast.Store) and item.id in binding_order and item not in binding_targets:
                    problem(file, item, "module name rebinding requires a source adapter")
                if not function and isinstance(item, ast.ExceptHandler) and item.name and (item.name in module["names"] or item.name in module["imports"]):
                    problem(file, item, "deleting Python names through exception cleanup requires a source adapter")
                if isinstance(item, ast.Name) and isinstance(item.ctx, ast.Load) and item.id not in local.names:
                    target = active(item.id)
                    if not function and eager and item.id in dependencies:
                        missing = sorted(name for name in dependencies[item.id] if binding_order[name] >= current_order)
                        if missing:
                            problem(file, item, "module initializer requires prior bindings: " + ", ".join(missing))
                    if target and target[0] == "@builtin" and target[1] in forbidden:
                        problem(file, item, "runtime reflection requires a source adapter")
                    if target and target[0] in ("@builtin", "@stdlib"):
                        parent = parents.get(item)
                        direct = isinstance(parent, ast.Call) and parent.func is item
                        attribute = isinstance(parent, ast.Attribute) and parent.value is item and target[0] == "@stdlib"
                        annotation = annotation_use(item)
                        if not (direct or attribute or annotation or exception_use(item, target) or (target[0] == "@stdlib" and data_export(target[1])) or target[1] in ("True", "False", "None", "__name__", "__file__", "__package__")):
                            problem(file, item, "escaped standard-library or builtin values require a source adapter")
                    if target is None:
                        problem(file, item, "unresolved global name: " + item.id)
                    elif not target[0].startswith("@"):
                        edge(file, item, owner, target[0])
                if isinstance(item, ast.Attribute):
                    selected_export = qualified(item, local.names)
                    if selected_export:
                        parent = parents.get(item)
                        prefix = isinstance(parent, ast.Attribute) and parent.value is item
                        if not supported_export(selected_export):
                            problem(file, item, "unsupported standard-library export: " + selected_export)
                        if not (isinstance(parent, ast.Call) and parent.func is item) and not prefix and not data_export(selected_export) and not annotation_use(item):
                            problem(file, item, "escaped standard-library values require a source adapter")
                    if isinstance(item.ctx, (ast.Store, ast.Del)):
                        problem(file, item, "attribute mutation requires a source adapter")
                    if isinstance(item.value, ast.Name):
                        base = active(item.value.id) if item.value.id not in local.names else None
                        if base and base[0] == "@stdlib" and base[1] == "os" and item.attr not in EXPORTS["os"]:
                            problem(file, item, "operating-system context requires a source adapter")
                    if not selected_export:
                        base = active(item.value.id) if isinstance(item.value, ast.Name) and item.value.id not in local.names else None
                        if (not base or base[0] != "@module") and item.attr not in {"year", "month", "day", "hour", "minute", "second", "microsecond", "days", "seconds", "numerator", "denominator", "real", "imag"}:
                            problem(file, item, "unresolved attribute access requires a source adapter")
                    if item.attr.startswith("__"):
                        problem(file, item, "runtime introspection requires a source adapter")
                    if isinstance(item.value, ast.Name) and item.value.id not in local.names:
                        target = active(item.value.id)
                        if target and target[0] == "@module":
                            selected = modules[target[1]]["names"].get(item.attr)
                            if selected:
                                edge(file, item, owner, selected[0])
                            else:
                                problem(file, item, "unresolved module attribute: " + item.attr)
                if isinstance(item, ast.Call):
                    call = item.func
                    target = active(call.id) if isinstance(call, ast.Name) and call.id not in local.names else None
                    if target and target[0] == "@builtin" and target[1] in forbidden:
                        problem(file, item, "reflection and dynamic imports require a source adapter")
                    if isinstance(call, ast.Name):
                        if target and target[0] not in ("@builtin", "@stdlib") and target[1] != "function":
                            problem(file, item, "dispatch through an assigned value requires a source adapter")
                        if call.id in local.names:
                            problem(file, item, "dispatch through a local value requires a source adapter")
                        if target == ("@builtin", "open"):
                            problem(file, item, "external resource reads and writes require a source adapter")
                    elif isinstance(call, ast.Attribute):
                        base = active(call.value.id) if isinstance(call.value, ast.Name) and call.value.id not in local.names else None
                        selected_call = qualified(call, local.names)
                        if not (selected_call and supported_export(selected_call)) and (not base or base[0] not in ("@stdlib", "@module")):
                            problem(file, item, "unresolved attribute dispatch requires a source adapter")
                        owned_call = base and base[0] == "@module" and modules[base[1]]["names"].get(call.attr, (None, None))[1] == "function"
                        if not owned_call and call.attr in {"listdir", "scandir", "walk", "system", "popen", "fork", "execv", "execve", "spawnv", "spawnve", "read", "read_text", "read_bytes", "getenv"}:
                            problem(file, item, "external context or process dispatch requires a source adapter")
                    else:
                        problem(file, item, "computed dispatch requires a source adapter")
    registry = modules.get(bindings)
    if registry:
        for node in registry["tree"].body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                if isinstance(node, ast.ImportFrom) and node.level:
                    problem(bindings, node, "relative binding imports require a regular package entry adapter")
                continue
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                continue
            if not (isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "actions" and isinstance(node.value, ast.Dict)):
                problem(bindings, node, "bindings require explicit imports and a literal actions dictionary")
                continue
            for key, value in zip(node.value.keys, node.value.values):
                target = resolved(bindings, value.id) if isinstance(value, ast.Name) else None
                if not isinstance(key, ast.Constant) or not isinstance(key.value, str) or not key.value or key.value in actions or not target or target[1] != "function" or target[0].split("#")[0] == bindings or kind(target[0].split("#")[0]) != "production":
                    problem(bindings, node, "each action must uniquely name an imported production function")
                else:
                    actions[key.value] = target[0]
        registry_id = registry["names"].get("actions", (None, None))[0]
        if registry_id:
            edge(bindings, registry["tree"], registry_id, registry["init"], "module-initialization")
    else:
        registry_id = None
        problems.append("Python bindings were not parsed")
    return {"source": {"files": measured, "components": components, "relationships": edges, "actions": actions, "registry": registry_id, "problems": list(dict.fromkeys(problems))}, "digests": digests}

# Owned imports always compile measured source, never an existing .pyc.
class SourceLoader(importlib.abc.SourceLoader):
    def __init__(self, path, data):
        self.path = path
        self.data = data
    def get_filename(self, fullname):
        return self.path
    def get_data(self, path):
        return self.data
    def get_code(self, fullname):
        return compile(source_text(self.get_data(self.path)), self.path, "exec", dont_inherit=True)

class OwnedFinder(importlib.abc.MetaPathFinder):
    def __init__(self, root, sources):
        self.root = os.path.realpath(root)
        self.sources = sources
    def find_spec(self, fullname, path=None, target=None):
        relative = fullname.replace(".", "/")
        for file, package in ((relative + "/__init__.py", True), (relative + ".py", False)):
            absolute = os.path.join(self.root, file)
            if file in self.sources:
                return importlib.util.spec_from_file_location(fullname, absolute, loader=SourceLoader(absolute, self.sources[file]), submodule_search_locations=[os.path.dirname(absolute)] if package else None)
        if os.path.exists(os.path.join(self.root, relative + ".pyc")) or os.path.isdir(os.path.join(self.root, relative)):
            raise ImportError("Sourceless and namespace-owned imports require a source adapter: " + fullname)
        if fullname.split(".")[0] not in sys.stdlib_module_names or (path and any(not os.path.realpath(entry).startswith(os.path.realpath(sysconfig.get_path("stdlib")) + os.sep) for entry in path)):
            raise ImportError("Python import is outside measured source and installed stdlib: " + fullname)
        return None

if sys.implementation.name != "cpython":
    raise RuntimeError("Bonsai Python analysis requires installed CPython 3.10-3.15")
request = decode_json(sys.stdin.readline())
compiler = context()
if request["mode"] == "identity":
    emit({"compiler": compiler})
elif request["mode"] == "analyze":
    emit({"compiler": compiler, **analyze(request)})
elif request["mode"] == "actions":
    # No result protocol descriptor is available to handlers or inherited children.
    # Drain/close bootstrap input before imports. stdout/stderr are diagnostic sinks.
    sys.stdin.read()
    os.close(0)
    if os.open(os.devnull, os.O_RDONLY) != 0:
        raise RuntimeError("Unable to close Python bootstrap input")
    if compiler != request["compiler"]:
        raise RuntimeError("Python runtime context changed after source analysis")
    result_path = request.pop("result")
    result_open, result_write, result_close = os.open, os.write, os.close
    root = os.path.realpath(request["root"])
    # Verify and freeze every module before the first candidate initializer runs.
    sources = {}
    for file, expected in request["digests"].items():
        absolute = os.path.join(root, file)
        if os.path.realpath(absolute) != absolute:
            raise ImportError("Python source path changed: " + file)
        with open(absolute, "rb") as source:
            data = source.read()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ImportError("Python source changed after analysis: " + file)
        source_text(data)  # Validate every encoding before the first initializer.
        sources[file] = data
    sys.meta_path.insert(0, OwnedFinder(root, sources))
    path = os.path.join(root, request["bindings"])
    specification = importlib.util.spec_from_file_location("__bonsai_bindings__", path, loader=SourceLoader(path, sources[request["bindings"]]))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    actions = module.actions
    if not isinstance(actions, dict) or not all(isinstance(key, str) and callable(value) for key, value in actions.items()):
        raise TypeError("Python bindings must expose an actions dictionary of named handlers")
    results = []
    for operation in request["operations"]:
        result = {"kind": "result", "id": operation["id"], "action": operation["action"]}
        try:
            value = actions[operation["action"]](operation["input"])
            if hasattr(value, "__await__"):
                value = asyncio.run(value)
            observations = []
            for selection in operation["selections"]:
                observation = {"selector": selection["selector"]}
                try:
                    selected = value
                    for key in selection["keys"]:
                        if type(selected) in MAPPING_TYPES and key in selected:
                            selected = selected[key]
                        elif type(selected) in (list, tuple) and key == "length":
                            selected = len(selected)
                        elif type(selected) in (list, tuple) and key.isdecimal() and str(int(key)) == key and int(key) < len(selected):
                            selected = selected[int(key)]
                        else:
                            raise KeyError("Missing response field: " + selection["selector"])
                    # Clone selections independently: unrelated values cannot break a field.
                    transferable(selected)
                    observation["value"] = decode_json(encode_json(selected, allow_nan=False, separators=(",", ":")))
                except Exception as error:
                    observation["error"] = str(error)[:4096]
                observations.append(observation)
            result["observations"] = observations
            # A bounded preview never traverses unselected containers or calls user hooks.
            try:
                preview = {}
                if type(value) in MAPPING_TYPES:
                    for key in list(value)[:8]:
                        if type(key) is str:
                            field = value[key]
                            preview[key[:64]] = field[:128] if type(field) is str else field if type(field) in (int, float, bool, type(None)) else "[Unselected value]"
                result["preview"] = encode_json(preview, allow_nan=True, separators=(",", ":"))[:512]
            except Exception:
                result["preview"] = "[Python response preview unavailable]"
        except Exception as error:
            result["error"] = str(error)[:4096]
        results.append(result)
    # Publish only after the entire plan has returned. No authoritative pipe is open.
    encoded = encode_json({"compiler": compiler, "results": results}, allow_nan=False, separators=(",", ":")).encode("utf8")
    if len(encoded) > 16 * 1024 * 1024:
        raise RuntimeError("Python action result exceeds 16 MiB")
    descriptor = result_open(result_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        offset = 0
        while offset < len(encoded):
            count = result_write(descriptor, encoded[offset:])
            if not count:
                raise RuntimeError("Incomplete Python action result")
            offset += count
    finally:
        result_close(descriptor)
`
