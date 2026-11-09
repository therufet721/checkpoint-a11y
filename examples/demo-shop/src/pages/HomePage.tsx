import { ProductCard } from '../components/ProductCard';
import { PromoBanner } from '../components/PromoBanner';
import { PRODUCTS } from '../store';

export function HomePage() {
  return (
    <>
      <h1>New season</h1>
      {import.meta.env.VITE_REGRESSION && <PromoBanner />}
      <div className="grid">{PRODUCTS.map((p) => <ProductCard key={p.id} product={p} />)}</div>
    </>
  );
}
