// Only rendered in the "regression" build, to simulate a pull request that introduces a new issue.
export function PromoBanner() {
  return (
    <div className="promo">
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='20' cy='20' r='18' fill='%23e5007a'/%3E%3C/svg%3E" width={40} height={40} />
      <span className="promo-text">Free shipping this week</span>
    </div>
  );
}
