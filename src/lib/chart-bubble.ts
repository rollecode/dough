// Chart callout bubbles are drawn as a plain SVG rect, so their width has to be worked out from the
// label. Counting characters is what this used to do, and it breaks as soon as a label mixes digits
// with a word: "456 € under" needs about 78px, while a flat 5.8px per character budgets 70px and the
// text spills out of the pill. Finnish hid it, because "456 € alle" is one character shorter.
//
// These are measured advance widths for the label font at 12px, weight 600.
export const BUBBLE_FONT_SIZE = 12;
export const BUBBLE_HEIGHT = 20;
export const BUBBLE_PADDING = 6;

const CHAR_W: Record<string, number> = {
  " ": 3.2,
  "€": 7.2,
  ".": 3.2,
  ",": 3.2,
  "−": 6.8,
  "-": 4.2,
  "+": 6.8,
};
const DIGIT_W = 6.5;
const LETTER_W = 6.3;

function textWidth(label: string): number {
  let w = 0;
  for (const c of label) {
    w += CHAR_W[c] ?? (c >= "0" && c <= "9" ? DIGIT_W : LETTER_W);
  }
  return w;
}

/** Pill width that fits `label` with even padding on both sides. */
export function bubbleWidth(label: string): number {
  return Math.ceil(textWidth(label)) + BUBBLE_PADDING * 2;
}
