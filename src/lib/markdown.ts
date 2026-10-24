import MarkdownIt from 'markdown-it';

// html: false drops raw HTML in content, so organizer-entered text cannot inject markup.
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

// External links open safely; internal links stay as they are.
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  const href = token.attrGet('href') ?? '';
  if (/^https?:\/\//i.test(href)) {
    token.attrSet('rel', 'noopener noreferrer');
    token.attrSet('target', '_blank');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export const renderMarkdown = (src: string) => md.render(src);
export const renderInline = (src: string) => md.renderInline(src);

// ---- Images, anchors and an outline, for blog posts --------------------------------------------------------

const MEDIA_PATH = (import.meta.env?.PUBLIC_MEDIA_BASE ?? '/media').replace(/\/$/, '');

// Only our own photos may appear in a post (the ones uploaded through the admin). A picture from anywhere else
// would leak visitors' addresses to another site and could change under us, so it shows as its alt text instead.
md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx]!;
  const src = token.attrGet('src') ?? '';
  const alt = md.utils.escapeHtml(token.content);
  if (!src.startsWith(`${MEDIA_PATH}/`) || src.includes('..')) return alt;
  const title = token.attrGet('title');
  const img = `<img src="${md.utils.escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async">`;
  return title ? `<figure>${img}<figcaption>${md.utils.escapeHtml(title)}</figcaption></figure>` : img;
};

const slugOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// h2 and h3 get an id, so a heading can be linked to and a table of contents can point at it.
md.core.ruler.push('heading_ids', (state) => {
  const used = new Set<string>();
  state.tokens.forEach((t, i) => {
    if (t.type !== 'heading_open' || (t.tag !== 'h2' && t.tag !== 'h3')) return;
    const base = slugOf(state.tokens[i + 1]?.content ?? '') || 'section';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    t.attrSet('id', id);
  });
});

/** The h2 headings of a document, in order, for a table of contents. */
export function outline(src: string): { id: string; text: string }[] {
  const tokens = md.parse(src, {});
  const out: { id: string; text: string }[] = [];
  const used = new Set<string>();
  tokens.forEach((t, i) => {
    if (t.type !== 'heading_open' || (t.tag !== 'h2' && t.tag !== 'h3')) return;
    const text = tokens[i + 1]?.content ?? '';
    const base = slugOf(text) || 'section';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    if (t.tag === 'h2') out.push({ id, text });
  });
  return out;
}
