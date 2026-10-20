export function validQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity > 0;
}

export function placeOrder(input: { quantity: number }) {
  return { status: validQuantity(input.quantity) ? 'accepted' : 'rejected' };
}
