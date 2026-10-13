import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandIcon } from "@/lib/brands";

test("a transparent mark sits inside the brand tile, a full app icon fills it", () => {
  assert.match(renderToStaticMarkup(createElement(BrandIcon, { img: "netflix.svg" })), /brand-mark/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(BrandIcon, { img: "cronometer.png" })), /brand-mark/);
});
