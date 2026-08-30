// GenUI echart guard: preset whitelist, height clamping, option sanitization
// (XSS filter, tooltip renderMode, array/node budget), and node rejection.
// Pure node tests — no DOM.
import { describe, expect, it } from 'vitest'
import { GENUI_LIMITS, repairGenuiSpec } from '../src/client/guard.ts'

const echart = (props: Record<string, unknown> = {}) => ({ type: 'echart', ...props })

describe('repairGenuiSpec: echart preset whitelist', () => {
  it('accepts all five valid presets', () => {
    for (const preset of ['bar', 'line', 'area', 'pie', 'scatter'] as const) {
      const spec = repairGenuiSpec({ items: [echart({ preset, data: [{ label: 'a', value: 1 }] })] })
      expect(spec?.items).toHaveLength(1)
      expect((spec?.items[0] as { preset: string }).preset).toBe(preset)
    }
  })

  it('drops invalid preset values (kept undefined, node survives via data)', () => {
    const spec = repairGenuiSpec({ items: [echart({ preset: 'bubble', data: [{ label: 'a', value: 1 }] })] })
    expect(spec?.items).toHaveLength(1)
    expect((spec?.items[0] as { preset?: string }).preset).toBeUndefined()
  })
})

describe('repairGenuiSpec: echart height clamping', () => {
  it('clamps height into 100–800', () => {
    const spec = repairGenuiSpec({ items: [
      echart({ preset: 'bar', height: 50, data: [{ label: 'a', value: 1 }] }),
      echart({ preset: 'bar', height: 9999, data: [{ label: 'a', value: 1 }] }),
      echart({ preset: 'bar', height: 300, data: [{ label: 'a', value: 1 }] }),
    ] })
    expect((spec?.items[0] as { height: number }).height).toBe(100)
    expect((spec?.items[1] as { height: number }).height).toBe(800)
    expect((spec?.items[2] as { height: number }).height).toBe(300)
  })

  it('defaults height when absent', () => {
    const spec = repairGenuiSpec({ items: [echart({ preset: 'bar', data: [{ label: 'a', value: 1 }] })] })
    expect((spec?.items[0] as { height?: number }).height).toBeUndefined()
  })
})

describe('repairGenuiSpec: echart node rejection', () => {
  it('drops an echart with no option, data, or series', () => {
    const spec = repairGenuiSpec({ items: [
      echart(),
      echart({ preset: 'bar' }), // preset alone without data/series
    ] })
    expect(spec?.items).toHaveLength(0)
  })

  it('keeps a series-only echart', () => {
    const spec = repairGenuiSpec({ items: [
      echart({ preset: 'bar', series: [{ label: 's', data: [{ label: 'a', value: 1 }] }] }),
    ] })
    expect(spec?.items).toHaveLength(1)
  })

  it('keeps an option-only echart', () => {
    const spec = repairGenuiSpec({ items: [
      echart({ option: { title: { text: 'ok' } } }),
    ] })
    expect(spec?.items).toHaveLength(1)
  })
})

describe('sanitizeEChartOption: XSS prevention (via repairGenuiSpec)', () => {
  it('forces tooltip.renderMode to richText', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { tooltip: { trigger: 'axis', formatter: '{b}: {c}' } },
    })] })
    const node = spec?.items[0] as { option?: { tooltip?: { renderMode?: string } } }
    expect(node?.option?.tooltip?.renderMode).toBe('richText')
  })

  it('forces renderMode richText even when tooltip has no formatter', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { tooltip: { trigger: 'item' } },
    })] })
    const node = spec?.items[0] as { option?: { tooltip?: { renderMode?: string } } }
    expect(node?.option?.tooltip?.renderMode).toBe('richText')
  })

  it('filters <script> tags from string values', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { title: { text: '<script>alert(1)</script>' } },
    })] })
    const node = spec?.items[0] as { option?: { title?: { text?: string } } }
    expect(node?.option?.title?.text).toBeUndefined()
  })

  it('filters <img onerror=...> from string values', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { tooltip: { formatter: '<img src=x onerror=alert(1)>' } },
    })] })
    const node = spec?.items[0] as { option?: { tooltip?: { formatter?: string } } }
    expect(node?.option?.tooltip?.formatter).toBeUndefined()
  })

  it('filters on[a-z]+= event handlers from string values', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { label: 'text onload=alert(1)' },
    })] })
    const node = spec?.items[0] as { option?: { label?: string } }
    expect(node?.option?.label).toBeUndefined()
  })

  it('filters javascript: URIs from string values', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { link: 'javascript:alert(1)' },
    })] })
    const node = spec?.items[0] as { option?: { link?: string } }
    expect(node?.option?.link).toBeUndefined()
  })

  it('filters url() CSS exfiltration from string values', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { backgroundColor: 'url(https://evil.example/track?u=1)' },
    })] })
    const node = spec?.items[0] as { option?: { backgroundColor?: string } }
    expect(node?.option?.backgroundColor).toBeUndefined()
  })

  it('filters image:// symbol URLs (browser network channel)', () => {
    // series[].symbol: 'image://…' makes ECharts fetch the URL — a
    // prompt-injected model could use it to exfiltrate data or track users.
    const spec = repairGenuiSpec({ items: [echart({
      option: { series: [{ type: 'bar', symbol: 'image://https://attacker.example/track.png' }] },
    })] })
    const node = spec?.items[0] as { option?: { series?: Array<{ symbol?: string }> } }
    expect(node?.option?.series?.[0]?.symbol).toBeUndefined()
  })

  it('filters data:image graphic.style.image (direct byte load)', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { graphic: [{ type: 'image', style: { image: 'data:image/png;base64,iVBORw0KGgo=' } }] },
    })] })
    const node = spec?.items[0] as { option?: { graphic?: Array<{ style?: { image?: string } }> } }
    expect(node?.option?.graphic?.[0]?.style?.image).toBeUndefined()
  })

  it('filters blob: URLs from tooltip formatter', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { tooltip: { formatter: 'blob:https://evil.example/uuid' } },
    })] })
    const node = spec?.items[0] as { option?: { tooltip?: { formatter?: string } } }
    expect(node?.option?.tooltip?.formatter).toBeUndefined()
  })

  it('strips a bare https:// URL from graphic[].style.image', () => {
    // ECharts fetches graphic[].style.image directly; ECHART_EXFIL_RE only
    // matches image:/data:/blob: PREFIXES, so a bare https:// URL previously
    // survived the string gate and became a tracking/exfil channel.
    const spec = repairGenuiSpec({ items: [echart({
      option: { graphic: [{ type: 'image', style: { image: 'https://attacker.example/track.png' } }] },
    })] })
    const node = spec?.items[0] as { option?: { graphic?: Array<{ style?: { image?: string } }> } }
    expect(node?.option?.graphic?.[0]?.style?.image).toBeUndefined()
  })

  it('strips a bare https:// URL from label.rich.*.backgroundColor.image', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { series: [{ type: 'bar', label: { rich: { i: { backgroundColor: { image: 'https://evil.example/badge.png' } } } } }] },
    })] })
    const node = spec?.items[0] as { option?: { series?: Array<{ label?: { rich?: Record<string, { backgroundColor?: { image?: string } }> } }> } }
    expect(node?.option?.series?.[0]?.label?.rich?.i?.backgroundColor?.image).toBeUndefined()
  })

  it('strips a protocol-relative // URL from graphic[].style.image', () => {
    // The browser resolves '//host/x' against the page's own scheme, so a
    // protocol-relative URL is fetched exactly like 'https://host/x' — the
    // previous scheme-only check (val.includes('://')) let it slip through.
    const spec = repairGenuiSpec({ items: [echart({
      option: { graphic: [
        { type: 'image', style: { image: '//evil.example/x.png' } },
        { type: 'image', style: { image: '  //evil.example/padded.png' } },
      ] },
    })] })
    const node = spec?.items[0] as { option?: { graphic?: Array<{ style?: { image?: string } }> } }
    expect(node?.option?.graphic?.[0]?.style?.image).toBeUndefined()
    expect(node?.option?.graphic?.[1]?.style?.image).toBeUndefined()
  })

  it('strips a protocol-relative // URL from label.rich.*.backgroundColor.image', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { series: [{ type: 'bar', label: { rich: { i: { backgroundColor: { image: '//evil.example/badge.png' } } } } }] },
    })] })
    const node = spec?.items[0] as { option?: { series?: Array<{ label?: { rich?: Record<string, { backgroundColor?: { image?: string } }> } }> } }
    expect(node?.option?.series?.[0]?.label?.rich?.i?.backgroundColor?.image).toBeUndefined()
  })

  it('keeps same-origin relative paths and // mentions in non-image keys', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: {
        graphic: [{ type: 'image', style: { image: 'img/local.png' } }],
        title: { text: '路径以 // 开头才是协议相对' },
      },
    })] })
    const node = spec?.items[0] as { option?: { graphic?: Array<{ style?: { image?: string } }>; title?: { text?: string } } }
    expect(node?.option?.graphic?.[0]?.style?.image).toBe('img/local.png')
    expect(node?.option?.title?.text).toBe('路径以 // 开头才是协议相对')
  })

  it('keeps text labels that merely mention a URL', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: {
        series: [{
          type: 'bar',
          label: {
            text: '访问 https://example.com 查看',
            rich: { i: { text: '见 https://docs.example.com/guide' } },
          },
        }],
      },
    })] })
    const node = spec?.items[0] as { option?: { series?: Array<{ label?: { text?: string; rich?: Record<string, { text?: string }> } }> } }
    expect(node?.option?.series?.[0]?.label?.text).toBe('访问 https://example.com 查看')
    expect(node?.option?.series?.[0]?.label?.rich?.i?.text).toBe('见 https://docs.example.com/guide')
  })

  it('preserves legitimate empty objects (previously collapsed to undefined)', () => {
    // An input `{}` (e.g. an empty style placeholder ECharts accepts) used
    // to fold to undefined, silently deleting the key.
    const spec = repairGenuiSpec({ items: [echart({
      option: { series: [{ type: 'bar', label: {} }], graphic: [{ type: 'rect', style: {} }] },
    })] })
    const node = spec?.items[0] as { option?: { series?: Array<{ label?: object }>; graphic?: Array<{ style?: object }> } }
    expect(node?.option?.series?.[0]?.label).toEqual({})
    expect(node?.option?.graphic?.[0]?.style).toEqual({})
  })

  it('preserves legitimate string values (CJK, templates, hex)', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: {
        title: { text: '销售趋势' },
        xAxis: { type: 'category', data: ['一月', '二月'] },
        backgroundColor: '#1a1a1e',
      },
    })] })
    const node = spec?.items[0] as { option?: { title?: { text?: string }; xAxis?: { data?: string[] }; backgroundColor?: string } }
    expect(node?.option?.title?.text).toBe('销售趋势')
    expect(node?.option?.xAxis?.data).toEqual(['一月', '二月'])
    expect(node?.option?.backgroundColor).toBe('#1a1a1e')
  })

  it('filters function values from option', () => {
    const spec = repairGenuiSpec({ items: [echart({
      option: { title: { text: 'ok' }, formatter: () => 'x' },
    })] })
    const node = spec?.items[0] as { option?: Record<string, unknown> }
    expect(node?.option?.title).toBeDefined()
    expect(node?.option?.formatter).toBeUndefined()
  })
})

describe('sanitizeEChartOption: resource budget (via repairGenuiSpec)', () => {
  it('caps array length to maxEChartArrayLen', () => {
    const hugeData = Array.from({ length: 10000 }, (_, i) => i)
    const spec = repairGenuiSpec({ items: [echart({
      option: { series: [{ data: hugeData }] },
    })] })
    const node = spec?.items[0] as { option?: { series?: Array<{ data?: unknown[] }> } }
    expect(node?.option?.series?.[0]?.data).toHaveLength(GENUI_LIMITS.maxEChartArrayLen)
  })

  it('caps total node count to maxEChartOptionNodes', () => {
    const huge: Record<string, unknown> = {}
    for (let i = 0; i < 3000; i++) huge[`k${i}`] = i
    const spec = repairGenuiSpec({ items: [echart({ option: huge })] })
    const node = spec?.items[0] as { option?: Record<string, unknown> }
    expect(node?.option).toBeDefined()
    expect(Object.keys(node!.option!)).toHaveLength(GENUI_LIMITS.maxEChartOptionNodes - 1)
  })

  it('caps nesting depth to maxEChartOptionDepth', () => {
    // Deep nesting beyond the limit causes the walk to return undefined at
    // the cutoff depth, which cascades up (each parent loses its only child
    // → empty object → undefined). The option gets stripped entirely.
    let inner: Record<string, unknown> = { v: 'leaf' }
    for (let i = 0; i < 20; i++) inner = { a: inner }
    const spec = repairGenuiSpec({ items: [echart({ option: inner })] })
    const node = spec?.items[0] as { option?: Record<string, unknown> }
    // The entire option is stripped because the deep nesting exceeds the
    // depth budget — every level above the cutoff becomes an empty object.
    expect(node?.option).toBeUndefined()

    // A nesting depth WITHIN the limit survives.
    let ok: Record<string, unknown> = { v: 'leaf' }
    for (let i = 0; i < 5; i++) ok = { a: ok }
    const spec2 = repairGenuiSpec({ items: [echart({ option: ok })] })
    const node2 = spec2?.items[0] as { option?: Record<string, unknown> }
    expect(node2?.option).toBeDefined()
  })
})
