import { describe, expect, it } from 'vitest';
import { pinGroupHtml } from './icons';

describe('pinGroupHtml: группы', () => {
  it('группа — знамя в своём цвете и участники под ним', () => {
    const html = pinGroupHtml(
      [{ id: 'pin-g', entity: 'g', name: 'Отряд', avatar: null, party: { color: '#ff0000', members: [{ name: 'Аня', avatar: 'a.webp' }, { name: 'Борис', avatar: null }] } }],
      0,
      'above',
    );
    expect(html).toContain('class="pin pin-party" style="--party:#ff0000"');
    expect(html.match(/class="pin-member"/g)).toHaveLength(2);
    expect(html).toContain('src="a.webp"');
  });

  it('больше шести участников — «+N»', () => {
    const members = Array.from({ length: 8 }, (_, i) => ({ name: `Игрок ${i}`, avatar: null }));
    const html = pinGroupHtml([{ id: 'pin-g', entity: 'g', name: 'Отряд', avatar: null, party: { color: null, members } }], 0, 'above');
    expect(html).toContain('+3');
  });

  it('обычный персонаж — без знамени', () => {
    expect(pinGroupHtml([{ id: 'pin-c', entity: 'c', name: 'Некто', avatar: null }], 0, 'above')).not.toContain('pin-party');
  });
});
