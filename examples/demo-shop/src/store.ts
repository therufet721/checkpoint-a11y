import { useSyncExternalStore } from 'react';

export interface Product { id: string; name: string; price: number; colour: string }

export const PRODUCTS: Product[] = [
  { id: 'blue-shirt', name: 'Blue Oxford Shirt', price: 49, colour: '#3b6ea5' },
  { id: 'rain-jacket', name: 'Packable Rain Jacket', price: 89, colour: '#2f7d5b' },
  { id: 'wool-socks', name: 'Merino Wool Socks', price: 15, colour: '#8a5a44' },
];

let cart: Product[] = [];
const listeners = new Set<() => void>();
export const cartStore = {
  add(p: Product) { cart = [...cart, p]; listeners.forEach((l) => l()); },
  clear() { cart = []; listeners.forEach((l) => l()); },
  subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
  get: () => cart,
};
export const useCart = () => useSyncExternalStore(cartStore.subscribe, cartStore.get);
