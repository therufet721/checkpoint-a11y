import { PRODUCTS, cartStore } from '../store';

export function ProductPage({ id, onAdded }: { id: string; onAdded: () => void }) {
  const product = PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0]!;
  return (
    <article className="product">
      <div className="swatch large" style={{ background: product.colour }} />
      <div>
        <h1>{product.name}</h1>
        <p className="price">€{product.price}</p>
        <label htmlFor="size">Size</label>
        <select id="size" defaultValue="M"><option>S</option><option>M</option><option>L</option></select>
        <button className="primary" onClick={() => { cartStore.add(product); onAdded(); }}>Add to cart</button>
      </div>
    </article>
  );
}
