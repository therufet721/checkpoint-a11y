import { navigate } from '../router';
import { useCart } from '../store';

// BUG: role="dialog" without aria-modal, and focus is not moved into it when it opens.
export function CartDrawer({ onClose }: { onClose: () => void }) {
  const cart = useCart();
  const total = cart.reduce((n, p) => n + p.price, 0);
  return (
    <div className="drawer" role="dialog" aria-label="Shopping cart">
      <h2>Your cart</h2>
      <ul>{cart.map((p, i) => <li key={i}>{p.name} · €{p.price}</li>)}</ul>
      <p>Total €{total}</p>
      <button className="primary" onClick={() => { onClose(); navigate('/checkout'); }}>Checkout</button>
      <button className="link-button" onClick={onClose}>Continue shopping</button>
    </div>
  );
}
