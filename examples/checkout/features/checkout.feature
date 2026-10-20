Feature: Checkout
  Scenario Outline: Place an order
    When I invoke "place-order" with {"quantity": <quantity>}
    Then response "status" equals "<status>"

    Examples:
      | quantity | status   |
      | 1        | accepted |
      | 0        | rejected |
      | -1       | rejected |
