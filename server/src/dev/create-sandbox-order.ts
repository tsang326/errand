/**
 * Creates one real sandbox order and prints the approve link, so the PayPal
 * half can be checked without the UI. Run: pnpm --filter @errand/server order
 */
import { createOrder, getOrder } from '../paypal/orders.js';

const order = await createOrder(
  [
    { productId: 'I8Kcjj2', title: 'Dinosaur Egg Toys', merchant: 'kohls.com', unitPrice: 34.12, quantity: 2, currency: 'USD' },
    { productId: 'fx-b', title: 'Dinosaur floor puzzle, 48 pieces', merchant: 'fixture-mart.example', unitPrice: 18.5, quantity: 1, currency: 'USD' },
  ],
  'https://errand.example/paid',
  'https://errand.example/cancelled',
);
console.log('CREATED', JSON.stringify(order, null, 1));
const fetched = await getOrder(order.id);
console.log('STATUS', fetched.status, 'TOTAL', JSON.stringify(fetched.purchase_units?.[0]));
