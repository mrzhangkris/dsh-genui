// SKILL.md frontmatter regression gate: the skill catalog silently IGNORES a
// skill whose YAML frontmatter fails to parse (the harness's yaml parser, not
// ours). The genui description historically contained `: ` sequences
// ("charts: callouts", "prose: 要点") which the parser rejects as compact
// nested mappings — the skill was invisible from install until quoted.
// This test pins the file against the SAME parser the host uses.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/** Replicate skill-filesystem's parseFrontmatter: leading `---`, body until the
 * next `---` line. */
function frontmatterYaml(raw: string): string {
  const lines = raw.slice(4).split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (line.trim() === '---') break
    out.push(line)
  }
  return out.join('\n')
}

describe('SKILL.md frontmatter (host yaml parser)', () => {
  const raw = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8')

  it('starts with the frontmatter fence', () => {
    expect(raw.startsWith('---\n')).toBe(true)
  })

  it('parses with the harness yaml parser', () => {
    expect(() => parse(frontmatterYaml(raw))).not.toThrow()
  })

  it('declares name and a non-empty description', () => {
    const data = parse(frontmatterYaml(raw)) as Record<string, unknown>
    expect(data.name).toBe('genui')
    expect(typeof data.description).toBe('string')
    expect((data.description as string).length).toBeGreaterThan(20)
  })
})

describe('SKILL.md body: table validate gate matches the injected section', () => {
  // Alignment regression (注入段与 SKILL.md 口径分叉): the injected
  // genui:fence section gates validate_dsh_ui on tables with rows≥5 only,
  // so SKILL.md must not demand pre-validation for EVERY table. The old
  // blanket trigger "表格/图表/嵌套容器…任一层级" silently re-tightened the
  // rule the injection had relaxed.
  const raw = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8')

  it('keys the table gate on rows ≥5 (not every table)', () => {
    expect(raw).toContain('rows ≥5 的表格')
    expect(raw).toContain('小表格（rows <5）')
    expect(raw).not.toContain('表格/图表/嵌套容器')
  })
})
