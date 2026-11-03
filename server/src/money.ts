/**
 * Money is integer cents everywhere inside this app and a string only at the
 * PayPal boundary. Channel3 hands out prices as JS numbers (34.12), and a cart
 * that adds three of those in floating point lands on totals like 86.57000000001,
 * which PayPal rejects outright: its Orders API validates that the breakdown
 * sums to the total to the cent.
 */
export type Cents = number;

export const toCents = (amount: number): Cents => Math.round(amount * 100);

export const centsToString = (c: Cents): string => (c / 100).toFixed(2);

export const sumCents = (values: readonly Cents[]): Cents =>
  values.reduce((a, b) => a + b, 0);

/** Line total for a quantity, kept in cents so rounding happens once. */
export const lineTotal = (unit: Cents, quantity: number): Cents => unit * quantity;
