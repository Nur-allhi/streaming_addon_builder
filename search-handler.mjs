// Shared handler for the Cloudflare Pages search functions.
// Everything except search is served as a plain static file from Pages.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=3600'
};

function empty() {
  return new Response(JSON.stringify({ metas: [] }), { headers: CORS });
}

export async function handleSearch({ params, env, request }) {
  const raw = params.search || '';

  // Pagination requests are plain static files - let Pages serve them.
  if (!raw.toLowerCase().startsWith('search=')) {
    return env.ASSETS.fetch(request);
  }

  let query = raw.slice('search='.length).replace(/\.json$/i, '');
  try {
    query = decodeURIComponent(query);
  } catch {
    /* keep raw query */
  }
  query = query.toLowerCase().trim();
  if (!query) return empty();

  const url = new URL('/search-index.json', request.url);
  const response = await env.ASSETS.fetch(new Request(url.href));
  if (!response.ok) return empty();

  const entries = await response.json();
  const wantedType = params.type || '';

  const matches = entries
    .filter((entry) => {
      if (wantedType && entry.type !== wantedType) return false;
      return String(entry.name || '').toLowerCase().includes(query);
    })
    .slice(0, 300)
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      name: entry.name,
      poster: entry.poster || undefined,
      releaseInfo: entry.year || undefined,
      description: 'Indexed from ctgfun'
    }));

  return new Response(JSON.stringify({ metas: matches }), { headers: CORS });
}
