import { describe, expect, it } from "vitest";

import { textureKind } from "../textureApi";

describe("textureKind", () => {
  it("returns 'model' only for the explicit model discriminator", () => {
    expect(textureKind({ kind: "model" })).toBe("model");
  });

  it("returns 'image' for images and any non-model value", () => {
    expect(textureKind({ kind: "image" })).toBe("image");
    // The backend types `kind` as a bare string; anything that isn't
    // exactly "model" must fall back to the safe image render path so a
    // stray value never tries to load a glTF.
    expect(textureKind({ kind: "video" as "image" })).toBe("image");
  });
});
