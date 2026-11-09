import { useState } from 'react';

// BUGS: invalid fields are marked aria-invalid but the error text is not linked to them,
// and the postcode error has no aria-invalid at all.
export function CheckoutPage() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [email, setEmail] = useState('');
  const [postcode, setPostcode] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = 'Enter a valid email address';
    if (!postcode) next.postcode = 'Postcode is required';
    setErrors(next);
  }

  return (
    <form className="checkout" onSubmit={submit} noValidate>
      <h1>Checkout</h1>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
        {errors.email && <span className="error">{errors.email}</span>}
      </div>
      <div className="field">
        <label htmlFor="postcode">Postcode</label>
        <input id="postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} />
        {errors.postcode && <span className="error">{errors.postcode}</span>}
      </div>
      <button className="primary" type="submit">Continue</button>
    </form>
  );
}
