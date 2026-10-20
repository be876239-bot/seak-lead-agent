/** Visual mark from the original side-panel concept; no interactive behavior. */
export default function BrandMark() {
  return <span className="sl-brand-mark" aria-hidden="true">
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="9" cy="9" r="6.5" />
      <circle cx="9" cy="9" r="2.4" />
      <path d="M9 9l4.6-4.6" stroke="#FFC64F" />
    </svg>
  </span>;
}
