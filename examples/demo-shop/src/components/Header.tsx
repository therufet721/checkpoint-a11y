import { useCart } from '../store';
import { navigate } from '../router';
import { IconButton } from './IconButton';

export function Header({ onCart }: { onCart: () => void }) {
  const cart = useCart();
  return (
    <header className="header">
      <a className="logo" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Northwind</a>
      <nav aria-label="Main">
        <a href="/products/blue-shirt" onClick={(e) => { e.preventDefault(); navigate('/products/blue-shirt'); }}>Shirts</a>
        <a href="/login" onClick={(e) => { e.preventDefault(); navigate('/login'); }}>Sign in</a>
      </nav>
      <div className="header-actions">
        <IconButton icon="🔍" label="Search" />
        <IconButton icon="🛒" label="Cart" onClick={onCart} />
        <span className="badge">{cart.length}</span>
      </div>
    </header>
  );
}
