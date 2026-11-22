// Pure helpers: hashing, normalising, language checks. No `$` here, so tests
// can call them directly.

/** cyrb53: a fast 53-bit string hash, as a base-36 string. */
export function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * The form both sides hash: what the model streamed and what the transcript
 * draws must land on the same key. The terminal hides `<context>` blocks from
 * a reply, so drop them here too, and ignore surrounding whitespace.
 */
export function normalize(text: string): string {
  return text.replace(/<context>[\s\S]*?<\/context>/g, '').trim()
}

export function trKey(lang: string, text: string): string {
  return `${lang}:${hash(normalize(text))}`
}

/** The primary subtag, lowercased: `zh-CN` → `zh`. */
export function baseLang(lang: string): string {
  return lang.split('-')[0]!.toLowerCase()
}

export function isEnglish(lang: string): boolean {
  return baseLang(lang) === 'en'
}

export function isValidLang(lang: string): boolean {
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)
}

// Languages written in their own script: a text with none of its letters is
// not in that language, so it needs no request to know it is passed through.
const SCRIPTS: Record<string, RegExp> = {
  zh: /\p{Script=Han}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  uk: /\p{Script=Cyrillic}/u,
  bg: /\p{Script=Cyrillic}/u,
  sr: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
  fa: /\p{Script=Arabic}/u,
  ur: /\p{Script=Arabic}/u,
  he: /\p{Script=Hebrew}/u,
  th: /\p{Script=Thai}/u,
  el: /\p{Script=Greek}/u,
  hi: /\p{Script=Devanagari}/u,
  mr: /\p{Script=Devanagari}/u,
  ne: /\p{Script=Devanagari}/u,
}

/**
 * False only when the text certainly is not in `lang`: the language has a
 * script of its own and the text holds none of it. True means "maybe": the
 * translator decides (it returns the text unchanged when it is English).
 */
export function mayBeIn(lang: string, text: string): boolean {
  const script = SCRIPTS[baseLang(lang)]
  return script ? script.test(text) : true
}

/** A reply longer than this is translated in pieces of about this size. */
export const PIECE_CHARS = 500

const FENCE = /^[ \t]*(`{3,}|~{3,})/

/**
 * Cuts a reply into pieces to translate one by one, so the start of a long
 * reply is shown translated while the rest is still on its way. A piece ends
 * at a blank line outside a code fence, before a line that starts flush left
 * (a list item's indented continuation stays with it), once it holds
 * `size` characters. Each cut depends only on the text before it, so a reply
 * cut while it streams and cut again whole gives the same pieces.
 *
 * `done` false (still streaming): only the pieces already closed are returned.
 */
export function pieces(text: string, done = true, size = PIECE_CHARS): string[] {
  let t = text
  if (!done) {
    // An unclosed <context> block is still streaming; normalize drops it once whole.
    const open = t.lastIndexOf('<context>')
    if (open > t.lastIndexOf('</context>')) t = t.slice(0, open)
  }
  const lines = normalize(t).split('\n')
  const out: string[] = []
  let start = 0
  let chars = 0
  let fence = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const cut =
      !fence && chars >= size && i > 0 && !lines[i - 1]!.trim() && line !== '' && !/^\s/.test(line)
    if (cut) {
      out.push(lines.slice(start, i).join('\n').trim())
      start = i
      chars = 0
    }
    // The last line of a streaming text may be partial: it only matters once whole.
    if (!done && i === lines.length - 1) break
    const m = FENCE.exec(line)
    if (m) {
      if (!fence) fence = m[1]!
      else if (m[1]![0] === fence[0] && m[1]!.length >= fence.length && line.trim() === m[1]) fence = ''
    }
    chars += line.trim().length
  }
  if (done) {
    const rest = lines.slice(start).join('\n').trim()
    if (rest) out.push(rest)
  }
  return out
}

/** The number of ``` fences: a translation that changes it broke a code block. */
export function fenceCount(text: string): number {
  return (text.match(/```/g) ?? []).length
}

export function languageName(lang: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang)
    if (name && name !== lang) return `${name} (${lang})`
  } catch {
    // Intl.DisplayNames missing or the code unknown: the code alone will do.
  }
  return `the language with BCP-47 code "${lang}"`
}

/**
 * A short look at a long text: its first `maxLines` non-blank lines, cut at
 * `maxChars` in all, with `…` when anything was left out.
 */
export function preview(text: string, maxLines = 2, maxChars = 160): string {
  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim())
  let out = lines.slice(0, maxLines).join('\n')
  let cut = lines.length > maxLines
  if (out.length > maxChars) {
    out = out.slice(0, maxChars - 1).trimEnd()
    cut = true
  }
  return cut ? `${out}…` : out
}
