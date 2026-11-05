import { invoke } from './cli.ts'
import { project } from './project.ts'

/** A Rust team keeps native handlers and bindings without a TypeScript bridge. */
export function checkRustProject() {
  const fixture = project(
    {
      'bindings.rs':
        'mod orders;\npub fn actions() -> &\'static [(&\'static str, fn(&str) -> String)] { &[("ready", orders::ready)] }\n',
      'orders.rs':
        'pub fn ready(_input: &str) -> String { let mut result = String::new(); result.push_str(r#"{"status":"ready"}"#); result }\n',
      'orders.feature':
        'Feature: Native orders\nScenario: Read an order\n When I invoke "ready" with {}\n Then response "status" equals "ready"\n',
    },
    {},
    { bindings: 'bindings.rs' },
  )
  try {
    return invoke(['check', '--root', fixture.root, '--serial'])
  } finally {
    fixture.dispose()
  }
}
