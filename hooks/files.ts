// The system prompt section that tells the model which language to write
// files in. Files are real output the person opens, so the model has to write
// them in the right language itself: translating a file after the write would
// leave the disk out of step with what the model remembers writing. The
// section names the language by its code only, says nothing of translation or
// of who reads the files, and leaves the model's replies alone.

/** The section's id in the system prompt. */
export const FILES_SECTION_ID = 'language-bridge:files'

/**
 * The rules, in English since the model reads English. They cover only files
 * the model creates; an existing file keeps its language. Ordered so the first
 * one that applies decides: an explicit request, then the project's
 * convention, and only then the person's language.
 */
export function filesSection(lang: string): string {
  return `# Language of new documents

When you create a new document, such as a Markdown file, write its prose in ${lang} unless a rule below says otherwise. This applies only to files you create: files that already exist keep the language they are written in. It does not change the language you reply in.

Pick the language of a new file by the first rule that applies:
1. The user asks for a language, an English version, or a bilingual document: do exactly that. A bilingual document has the same content in each language.
2. The file belongs to the project (README, docs, changelog, code comments): follow the language the project's existing files of that kind use. When there are none to follow, use English.
3. Otherwise (a plan, report, notes, summary, analysis or other Markdown document), write it in ${lang}.

In every language, keep code, commands, paths, identifiers, configuration keys and quoted output exactly as they are. When you pick a language the user may not expect, say which in one line of your reply.`
}
