declare module 'claude-code' {
  interface PluginState {
    'language-bridge': {
      /** Translation of an English reply block, keyed `${lang}:${hash(text)}`. */
      tr: StateFamily<string>
      /** The prompt as the person typed it, keyed `hash(englishText)`. */
      orig: StateFamily<string>
      /** Language chosen with /lang this session; unset falls back to userConfig. */
      lang: string
      /** Whether this session has been given a title from its first prompt. */
      titled: boolean
    }
  }
}
