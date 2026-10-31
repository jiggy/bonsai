import { invoke } from './cli.ts'
import { project } from './project.ts'

/** A Python team keeps its ordinary native handler and action dictionary. */
export function checkPythonProject() {
  const fixture = project(
    {
      'bindings.py': 'from orders import place_order\nactions = {"place-order": place_order}\n',
      'orders.py':
        'def place_order(request):\n    return {"status": "accepted" if request["quantity"] > 0 else "rejected"}\n',
      'orders.feature':
        'Feature: Place orders\nScenario: Accept a valid order\n When I invoke "place-order" with {"quantity": 1}\n Then response "status" equals "accepted"\n',
    },
    {},
    { bindings: 'bindings.py' },
  )
  try {
    return invoke(['check', '--root', fixture.root])
  } finally {
    fixture.dispose()
  }
}
