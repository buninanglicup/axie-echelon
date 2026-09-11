# Axie Search Pagination Dock

The Morph Viewer uses one shared pagination element for both Axie ID and Ronin
address results.

## Implementation

- `src/axieLookup/axieLookupState.js` creates `<nav aria-label="Pagination">`.
- `src/axieLookup/axieLookupView.js` renders controls for both existing data paths.
- `style.css` provides the fixed dock, active and focus states, mobile layout,
  safe-area spacing, and bottom clearance for the final result row.
- `index.html` provides the `#results` mount point and concise search guidance.

The existing `axieLookupState.currentPage`, `renderPage()`, `loadPage()`, API
requests, filters, and card rendering remain the source of truth. No duplicate
page state or new API behavior was introduced.

## Page ranges and accessibility

Seven or fewer pages show every page. Larger result sets show page 1, the last
page, the current page, nearby pages, and noninteractive ellipses for omitted
ranges. The active page has `aria-current="page"` and a green selected state.

Previous and next are native buttons with accessible labels and are disabled at
the boundaries. The page status uses `aria-live="polite"`. After a page change,
the rendered results scroll smoothly to `#results-header`, not to the top of the
whole application.

## Responsive behavior

Desktop uses a centered fixed dock at `bottom: 16px`. The results grid reserves
112px of bottom padding so the final card is not obscured. At widths of 640px or
less, page-number buttons are hidden, the dock uses `calc(100vw - 24px)`, and
the bottom offset includes `env(safe-area-inset-bottom)`.