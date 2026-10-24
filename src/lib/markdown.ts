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
