import { Application, Assets, Container } from "pixi.js";
import {
  Spine,
  TextureAtlas,
  AtlasAttachmentLoader,
  SkeletonJson
} from "@pixi-spine/all-3.8";

import {
  initAxieMixer,
  getAxieSpineFromGenes,
  getAxieColorPartShift,
  getVariantAttachmentPath
} from "@axieinfinity/mixer";

import GenesData from "@axieinfinity/mixer/dist/data/axie-2d-v3-stuff-genes.json";
import SamplesData from "@axieinfinity/mixer/dist/data/axie-2d-v3-stuff-samples.json";
import VariantsData from "@axieinfinity/mixer/dist/data/axie-2d-v3-stuff-variant.json";
import AnimationsData from "@axieinfinity/mixer/dist/data/axie-2d-v3-stuff-animations.json";

const AXIE_IMAGES_URL =
  "https://axiecdn.axieinfinity.com/mixer-stuffs/v6/";

let mixerInitialized = false;

function initializeMixer() {
  if (mixerInitialized) return;

  initAxieMixer(
    GenesData,
    SamplesData,
    VariantsData,
    AnimationsData
  );

  mixerInitialized = true;
}

let sharedApp = null;
let sharedRenderLock = Promise.resolve();

function getSharedApp() {
  if (!sharedApp) {
    sharedApp = new Application({
      width: 360,
      height: 360,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
  }
  return sharedApp;
}

function withSharedRenderLock(task) {
  const resultPromise = sharedRenderLock.then(() => task());
  sharedRenderLock = resultPromise.then(
    () => undefined,
    () => undefined
  );
  return resultPromise;
}

export async function renderMorphedAxie(target, genes, options = {}) {
  const {
    snapshot = false,
    width = 360,
    height = 360,
    imageWidth = "100%",
    imageHeight = "180px"
  } = options;

  if (!genes) {
    throw new Error("No gene string was returned.");
  }

  initializeMixer();
  target.replaceChildren();

  if (!snapshot) {
    const app = new Application({
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });

    target.appendChild(app.view);

    let result;

    try {
      result = getAxieSpineFromGenes(genes, new Map(), false);
    } catch (error) {
      const preview = typeof genes === "string" ? genes.slice(0, 24) : String(genes ?? "");
      throw new Error(
        `Mixer could not build the Axie preview for genes ${preview || "(empty)"}: ${error.message}`
      );
    }

    const skeletonData = result?.skeletonDataAsset;
    const variant = result?.variant;

    if (!skeletonData) {
      const preview = typeof genes === "string" ? genes.slice(0, 24) : String(genes ?? "");
      throw new Error(
        `Mixer did not return skeleton data for genes ${preview || "(empty)"}.`
      );
    }

    if (!variant) {
      throw new Error("Mixer did not return an Axie variant.");
    }

    const resources = getRequiredTextures(skeletonData, variant);

    const loadedTextures = await Promise.all(
      resources.map(async ({ key, imagePath }) => {
        const texture = await Assets.load(imagePath);
        return { key, texture };
      })
    );

    const textureHash = {};

    for (const { key, texture } of loadedTextures) {
      textureHash[key] = texture;
    }

    const atlas = new TextureAtlas();
    atlas.addTextureHash(textureHash, false);

    const attachmentLoader = new AtlasAttachmentLoader(atlas);
    const skeletonJson = new SkeletonJson(attachmentLoader);
    const spineData = skeletonJson.readSkeletonData(skeletonData);

    const spine = new Spine(spineData);

    const holder = new Container();
    holder.x = 180;
    holder.y = 260;

    spine.x = 20;
    spine.y = 0;
    spine.scale.set(0.35, 0.35);

    spine.state.setAnimation(0, "action/idle/normal", true);

    holder.addChild(spine);
    app.stage.addChild(holder);

    return app;
  }

  let result;

  try {
    result = getAxieSpineFromGenes(genes, new Map(), false);
  } catch (error) {
    const preview = typeof genes === "string" ? genes.slice(0, 24) : String(genes ?? "");
    throw new Error(
      `Mixer could not build the Axie preview for genes ${preview || "(empty)"}: ${error.message}`
    );
  }

  const skeletonData = result?.skeletonDataAsset;
  const variant = result?.variant;

  if (!skeletonData) {
    const preview = typeof genes === "string" ? genes.slice(0, 24) : String(genes ?? "");
    throw new Error(
      `Mixer did not return skeleton data for genes ${preview || "(empty)"}.`
    );
  }

  if (!variant) {
    throw new Error("Mixer did not return an Axie variant.");
  }

  const resources = getRequiredTextures(skeletonData, variant);

  const loadedTextures = await Promise.all(
    resources.map(async ({ key, imagePath }) => {
      const texture = await Assets.load(imagePath);
      return { key, texture };
    })
  );

  const textureHash = {};

  for (const { key, texture } of loadedTextures) {
    textureHash[key] = texture;
  }

  const atlas = new TextureAtlas();
  atlas.addTextureHash(textureHash, false);

  const attachmentLoader = new AtlasAttachmentLoader(atlas);
  const skeletonJson = new SkeletonJson(attachmentLoader);
  const spineData = skeletonJson.readSkeletonData(skeletonData);

  const spine = new Spine(spineData);

  const holder = new Container();
  holder.x = 180;
  holder.y = 260;

  spine.x = 20;
  spine.y = 0;
  spine.scale.set(0.35, 0.35);

  spine.state.setAnimation(0, "action/idle/normal", true);

  holder.addChild(spine);

  return withSharedRenderLock(async () => {
    const app = getSharedApp();
    app.renderer.resize(width, height);
    app.stage.addChild(holder);

    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const snapshotCanvas = app.renderer.extract.canvas(app.stage);
      const dataUrl = snapshotCanvas.toDataURL("image/png");
      const img = new Image();
      img.src = dataUrl;
      img.style.width = imageWidth;
      img.style.height = imageHeight;
      img.alt = "Morphed Axie preview";
      target.replaceChildren(img);
      return null;
    } finally {
      app.stage.removeChildren();
    }
  });
}

function getRequiredTextures(skeletonData, variant) {
  const skinAttachments = skeletonData.skins[0].attachments;
  const resources = new Map();

  const partColorShift = getAxieColorPartShift(variant);

  for (const slotName in skinAttachments) {
    const slotAttachments = skinAttachments[slotName];

    for (const attachmentName in slotAttachments) {
      const attachment = slotAttachments[attachmentName];
      const path = attachment.path;

      const imagePath =
        AXIE_IMAGES_URL +
        getVariantAttachmentPath(
          slotName,
          path,
          variant,
          partColorShift
        );

      resources.set(path, {
        key: path,
        imagePath
      });
    }
  }

  return [...resources.values()];
}