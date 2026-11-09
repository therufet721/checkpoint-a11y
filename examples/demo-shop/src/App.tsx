import { useState } from 'react';
import { CartDrawer } from './components/CartDrawer';
import { Header } from './components/Header';
import { CheckoutPage } from './pages/CheckoutPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { ProductPage } from './pages/ProductPage';
import { usePath } from './router';

export function App() {
  const path = usePath();
  const [cartOpen, setCartOpen] = useState(false);

  let page = <HomePage />;
  if (path.startsWith('/products/')) page = <ProductPage id={path.split('/')[2]!} onAdded={() => setCartOpen(true)} />;
  else if (path === '/checkout') page = <CheckoutPage />;
  else if (path === '/login') page = <LoginPage />;

  return (
    <div className="app">
      <Header onCart={() => setCartOpen(true)} />
      <main>{page}</main>
      <footer className="footer">
        <a href="/help">Help centre</a> · <a href="/contact">Contact us</a>
      </footer>
      {cartOpen && <CartDrawer onClose={() => setCartOpen(false)} />}
    </div>
  );
}
