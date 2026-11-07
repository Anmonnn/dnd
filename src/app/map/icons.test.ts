import { describe, expect, it } from 'vitest';
import { markerHtml } from './icons';

describe('markerHtml', () => {
  it('без цвета — значок в цвете типа', () => {
    const html = markerHtml('city', 'Монлак', null);
    expect(html).toContain('class="mk-badge"');
    expect(html).not.toContain('--ring');
  });

  it('с цветом места — значок в цвете фракции', () => {
    const html = markerHtml('city', 'Монлак', null, false, '#7fa8ff');
    expect(html).toContain('class="mk-badge mk-themed" style="--ring:#7fa8ff"');
    expect(html).toContain('Монлак');
  });

  it('у надписей без значка цвет не нужен', () => {
    expect(markerHtml('water', 'Залив', null, true, '#7fa8ff')).not.toContain('mk-badge');
  });
});
