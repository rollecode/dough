import { BRANDS, getBrandConfig, isKnownBrand, brandImagePath } from "./brand-table";

export { BRANDS, getBrandConfig, isKnownBrand, brandImagePath };

export function BrandIcon({ logo, img }: { logo?: string; img?: string }) {
  if (img) {
    return <img className="brand-img" src={`/brands/${img}`} alt="" />;
  }
  return <>{logo}</>;
}
