import { renderMorphedAxie } from "../renderer.js";

const renderCache = new Map();

export async function renderMorphedAxieCached(target, genes, options = {}) {
  const cacheKey = JSON.stringify({ genes, options });
  const cachedImage = renderCache.get(cacheKey);

  if (cachedImage) {
    const image = cachedImage.cloneNode(true);
    target.replaceChildren(image);
    return null;
  }

  await renderMorphedAxie(target, genes, options);

  const image = target.querySelector("img");
  if (image) renderCache.set(cacheKey, image.cloneNode(true));
}