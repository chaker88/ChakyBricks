export interface AnsiSegment {
  text: string;
  color: string | null;
  bold: boolean;
}

const COLORS: Record<number, string> = {
  30: "ansi-black",
  31: "ansi-red",
  32: "ansi-green",
  33: "ansi-yellow",
  34: "ansi-blue",
  35: "ansi-magenta",
  36: "ansi-cyan",
  37: "ansi-white",
};

// eslint-disable-next-line no-control-regex -- ANSI sequences start with ESC
const ESCAPE = /\x1b\[([0-9;]*)m/g;
// eslint-disable-next-line no-control-regex -- ANSI sequences start with ESC
const OTHER_ESCAPES = /\x1b\[[0-9;?]*[A-Za-ln-z]/g;

export function parseAnsi(input: string): AnsiSegment[] {
  const text = input.replace(OTHER_ESCAPES, "");
  const segments: AnsiSegment[] = [];
  let color: string | null = null;
  let bold = false;
  let last = 0;

  const push = (chunk: string) => {
    if (!chunk) return;
    const previous = segments[segments.length - 1];
    if (previous && previous.color === color && previous.bold === bold) previous.text += chunk;
    else segments.push({ text: chunk, color, bold });
  };

  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;
    const codes = match[1] === "" ? [0] : match[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) {
        color = null;
        bold = false;
      } else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = null;
      else if (code >= 30 && code <= 37) color = COLORS[code];
      else if (code >= 90 && code <= 97) color = COLORS[code - 60];
      else if (code === 38 && codes[i + 1] === 5) i += 2;
      else if (code === 38 && codes[i + 1] === 2) i += 4;
    }
  }
  push(text.slice(last));
  return segments;
}

export function stripAnsi(input: string): string {
  return parseAnsi(input)
    .map((s) => s.text)
    .join("");
}
