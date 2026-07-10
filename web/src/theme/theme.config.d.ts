// Types for the plain-JS theme.config.js (single source of truth).
export type ColorHex = string;

export const aqua: {
  accent: ColorHex; accentSoft: ColorHex; accentDeep: ColorHex;
  accentBg: ColorHex; accentBg2: ColorHex; cyan: ColorHex;
  pink: ColorHex; peach: ColorHex; mint: ColorHex;
};
export const brandScale: Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700, ColorHex>;
export const semantic: { success: ColorHex; danger: ColorHex; warning: ColorHex; white: ColorHex };
export const palette: Record<string, unknown>;
export const radii: Record<"xs" | "sm" | "md" | "lg" | "xl" | "pill", string>;
export const spacing: Record<"xxs" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl", string>;
export const fontSize: Record<string, string>;
export const shadows: { card: string; glow: string; pop: string };
export const brandGradient: string;
export const GRADIENTS: Array<[ColorHex, ColorHex]>;
export function gradientFromString(s?: string): [ColorHex, ColorHex];
export const cssVars: { light: Record<string, string>; dark: Record<string, string> };

declare const _default: {
  aqua: typeof aqua; brandScale: typeof brandScale; semantic: typeof semantic;
  palette: typeof palette; radii: typeof radii; spacing: typeof spacing;
  fontSize: typeof fontSize; shadows: typeof shadows; brandGradient: string;
  GRADIENTS: typeof GRADIENTS; gradientFromString: typeof gradientFromString;
  cssVars: typeof cssVars;
};
export default _default;
