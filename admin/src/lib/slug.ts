/** Item ids become file names and URLs: lowercase letters, digits and hyphens (same rule as the API and the schema). */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isValidId = (id: string) => id.length > 0 && id.length <= 80 && ID_PATTERN.test(id);

export function slugify(text: string, max = 60): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}
