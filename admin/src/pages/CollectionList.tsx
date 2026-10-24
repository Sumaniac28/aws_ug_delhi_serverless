import { Link } from 'react-router';
import type { CollectionName, ListItem } from '../lib/api.ts';
import { COLLECTIONS } from '../lib/collections.ts';
import { formatIst } from '../lib/ist.ts';
import { useApi } from '../state/app.tsx';
import { useAsync } from '../state/hooks.ts';
import { Alert, Badge, Button, ButtonLink, PageHeading, Spinner } from '../ui/primitives.tsx';

/** Events and posts newest first; everything else alphabetically. */
function sorted(collection: CollectionName, items: ListItem[]): ListItem[] {
  const copy = [...items];
  const date = (i: ListItem) => Date.parse(String(collection === 'events' ? i.start : i.pubDate)) || 0;
  if (collection === 'events' || collection === 'posts') return copy.sort((a, b) => date(b) - date(a));
  return copy.sort((a, b) => COLLECTIONS[collection].titleOf(a).localeCompare(COLLECTIONS[collection].titleOf(b)));
}

export function CollectionList({ collection }: { collection: CollectionName }) {
  const meta = COLLECTIONS[collection];
  const api = useApi();
  const list = useAsync(() => api.list(collection), `list:${collection}`);

  return (
    <>
      <PageHeading title={meta.label}>
        <ButtonLink to={`/c/${collection}/new`} variant="primary">
          New {meta.singular}
        </ButtonLink>
      </PageHeading>

      {list.loading && !list.data && <Spinner label={`Loading ${meta.label.toLowerCase()}`} />}
      {list.error && (
        <Alert tone="error" title={`Could not load ${meta.label.toLowerCase()}.`} actions={<Button onClick={list.reload}>Try again</Button>}>
          {list.error.message}
        </Alert>
      )}
      {list.data && list.data.length === 0 && (
        <p className="rounded-md border border-border p-6 text-muted-foreground">
          No {meta.label.toLowerCase()} yet. Use “New {meta.singular}” to add the first.
        </p>
      )}
      {list.data && list.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left">
            <caption className="visually-hidden">{meta.label}</caption>
            <thead>
              <tr className="border-b-2 border-foreground">
                <th scope="col" className="py-2 pr-4 font-bold">
                  Name
                </th>
                {meta.columns.map((c) => (
                  <th key={c.header} scope="col" className="py-2 pr-4 font-bold">
                    {c.header}
                  </th>
                ))}
                <th scope="col" className="py-2 font-bold">
                  Last saved
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted(collection, list.data).map((item) => (
                <tr key={item.id} className="border-b border-border align-top">
                  <th scope="row" className="py-3 pr-4 font-normal">
                    <Link to={`/c/${collection}/${item.id}`} className="link font-bold">
                      {meta.titleOf(item)}
                    </Link>
                    {item.invalid && (
                      <span className="ml-2">
                        <Badge tone="error">Needs fixing</Badge>
                      </span>
                    )}
                  </th>
                  {meta.columns.map((c) => (
                    <td key={c.header} className="py-3 pr-4 text-muted-foreground">
                      {c.render(item)}
                    </td>
                  ))}
                  <td className="py-3 text-muted-foreground">
                    {formatIst(item.lastModified)}
                    {item.editor ? ` by ${item.editor}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
