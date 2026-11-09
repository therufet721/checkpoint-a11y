import { navigate } from '../router';
import type { Product } from '../store';

// BUG: clickable card is a div with an onClick, so keyboard users cannot open it.
export function ProductCard({ product }: { product: Product }) {
  return (
    <div className="card" onClick={() => navigate(`/products/${product.id}`)}>
      <div className="swatch" style={{ background: product.colour }} />
      <h2>{product.name}</h2>
      <p className="price">€{product.price}</p>
    </div>
  );
}
