// BUGS (WCAG 2.2 3.3.8): paste is blocked on the password field and autocomplete is missing.
export function LoginPage() {
  return (
    <form className="login" onSubmit={(e) => e.preventDefault()}>
      <h1>Sign in</h1>
      <div className="field">
        <label htmlFor="login-email">Email</label>
        <input id="login-email" type="email" />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" type="password" onPaste={(e) => e.preventDefault()} />
      </div>
      <button className="primary" type="submit">Sign in</button>
    </form>
  );
}
