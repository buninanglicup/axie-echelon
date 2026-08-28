export function getPageItems(items, page, pageSize) {
  const safeItems = Array.isArray(items) ? items : [];
  const safePageSize = Math.max(1, Number(pageSize) || 1);
  const totalItems = safeItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));

  const requestedPage = Math.max(1, Number(page) || 1);
  const safePage = Math.min(requestedPage, totalPages);
  const startIndex = (safePage - 1) * safePageSize;
  const endIndex = startIndex + safePageSize;

  return {
    items: safeItems.slice(startIndex, endIndex),
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    startIndex,
    endIndex
  };
}
