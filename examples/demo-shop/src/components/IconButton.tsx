// BUG (design system): icon-only button with no accessible name. Every usage inherits it.
export function IconButton({ icon, onClick, label: _label }: { icon: string; onClick?: () => void; label?: string }) {
  return (
    <button className="icon-button" onClick={onClick}>
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
