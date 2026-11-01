import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import { nodeTransport } from '../src/mapping/transport.ts'
import { WIDGET_TEXTS } from '../src/runtime/networkHealth.ts'
import { ZwaveIntegration } from '../src/runtime/ZwaveIntegration.ts'
import { createFakeGladys, createFakeLogger } from './helpers/fakes.ts'

/**
 * Four languages everywhere a user reads something: the manifest, the texts the
 * code produces, the user documentation and the READMEs.
 */

const LANGUAGES = ['en', 'fr', 'de', 'es'] as const

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const manifest = JSON.parse(read('gladys-assistant-integration.json')) as Record<string, unknown>

/** Every multi-language object of a JSON tree, with its path. */
function multiLanguageObjects(
  value: unknown,
  path = '$',
): Array<[string, Record<string, unknown>]> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => multiLanguageObjects(item, `${path}[${index}]`))
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (typeof object.en === 'string') {
      return [[path, object]]
    }
    return Object.entries(object).flatMap(([key, child]) =>
      multiLanguageObjects(child, `${path}.${key}`),
    )
  }
  return []
}

const hasEveryLanguage = (object: Record<string, unknown>) =>
  LANGUAGES.every((lang) => typeof object[lang] === 'string' && object[lang] !== '')

test('every text of the manifest exists in the four languages', () => {
  const texts = multiLanguageObjects(manifest)
  assert.ok(texts.length > 50, 'the manifest texts were found')
  for (const [path, text] of texts) {
    assert.ok(hasEveryLanguage(text), `${path} lacks a language: ${Object.keys(text).join(', ')}`)
  }
})

test('the store description is 10 to 100 characters in every language', () => {
  const description = manifest.description as Record<string, string>
  for (const lang of LANGUAGES) {
    const length = description[lang]?.length ?? 0
    assert.ok(length >= 10 && length <= 100, `${lang}: ${length} characters`)
  }
})

test('the widget label is 3 to 30 characters in every language', () => {
  for (const widget of manifest.widgets as Array<{ key: string; label: Record<string, string> }>) {
    for (const lang of LANGUAGES) {
      const length = widget.label[lang]?.length ?? 0
      assert.ok(length >= 3 && length <= 30, `${widget.key}.${lang}: ${length} characters`)
    }
  }
})

test('every text of the widget exists in the four languages', () => {
  for (const [key, text] of Object.entries(WIDGET_TEXTS)) {
    assert.ok(hasEveryLanguage(text), key)
  }
})

test('the messages of the integration exist in the four languages', () => {
  const integration = new ZwaveIntegration(createFakeGladys().gladys, createFakeLogger())
  // Not configured, then no node known: the two answers a new user sees first.
  assert.ok(hasEveryLanguage({ ...integration.testConnection() }))
  assert.ok(hasEveryLanguage({ ...integration.dumpDevices() }))

  const badge = nodeTransport({ id: 2, status: 'Alive', ready: false })
  assert.ok(badge?.message && hasEveryLanguage({ ...badge.message }))
})

/** The heading levels of a Markdown file, code blocks left out. */
function headingLevels(text: string): number[] {
  const withoutCode = text.replaceAll(/```[\s\S]*?```/g, '')
  return [...withoutCode.matchAll(/^(#{1,6}) /gm)].map((match) => match[1]!.length)
}

test('the user documentation exists in the four languages, with the same structure', () => {
  const reference = headingLevels(read('docs/en.md'))
  for (const lang of LANGUAGES) {
    const file = `docs/${lang}.md`
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} is missing`)
    const text = read(file)
    assert.ok(text.length > 300, `${file} is too short for the store`)
    assert.deepEqual(headingLevels(text), reference, `${file} does not follow docs/en.md`)
  }
})

const README = { en: 'README.md', fr: 'README.fr.md', de: 'README.de.md', es: 'README.es.md' }

test('the README exists in the four languages, linked to each other, with the same structure', () => {
  const reference = headingLevels(read(README.en))
  for (const lang of LANGUAGES) {
    const text = read(README[lang])
    for (const other of LANGUAGES.filter((candidate) => candidate !== lang)) {
      assert.ok(
        text.includes(`](${README[other]})`),
        `${README[lang]} does not link ${README[other]}`,
      )
    }
    assert.match(text, /^!\[[^\]]+\]\(cover\.jpg\)$/m, `${README[lang]} shows no cover`)
    assert.ok(
      text.includes('sescandell/gladys-zwavejs'),
      `${README[lang]} does not credit the upstream`,
    )
    assert.deepEqual(headingLevels(text), reference, `${README[lang]} does not follow README.md`)
  }
})
