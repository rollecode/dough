import { BRANDS, getBrandConfig, isKnownBrand, brandImagePath } from "./brand-table";

export { BRANDS, getBrandConfig, isKnownBrand, brandImagePath };

export function BrandIcon({ logo, img }: { logo?: string; img?: string }) {
  if (img) {
    // SVGs are transparent marks drawn on the brand colour; bitmaps are full app icons
    const className = img.endsWith(".svg") ? "brand-img brand-mark" : "brand-img";
    return <img className={className} src={`/brands/${img}`} alt="" />;
  }
  return <>{logo}</>;
}
