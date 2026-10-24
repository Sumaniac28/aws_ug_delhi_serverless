// CloudFront Function (cloudfront-js-2.0), runs on every viewer request to the site behaviour.
// S3 behind OAC does not map directories to index.html, so this does it, plus the canonical-URL
// redirects the SEO plan needs (ADR-002 P0): trailing slashes and one canonical host.
// The two constants below are filled in at synth time by lib/viewer-request.ts, because
// CloudFront Functions have no environment variables.

var CANONICAL_HOST = '__CANONICAL_HOST__'; // empty string disables the host redirect
var REDIRECTS = __REDIRECTS__; // lowercase path without trailing slash -> new path (infra/redirects.json)

function redirect(location) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: location },
      'cache-control': { value: 'public, max-age=3600' },
    },
  };
}

function queryString(request) {
  var parts = [];
  var qs = request.querystring || {};
  Object.keys(qs).forEach(function (k) {
    var entry = qs[k];
    if (entry.multiValue) {
      entry.multiValue.forEach(function (m) {
        parts.push(k + '=' + m.value);
      });
    } else {
      parts.push(entry.value === '' ? k : k + '=' + entry.value);
    }
  });
  return parts.length ? '?' + parts.join('&') : '';
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var host = request.headers.host ? request.headers.host.value : '';
  var qs = queryString(request);

  // Old URLs first, so they reach their new home in a single hop.
  var target = REDIRECTS[uri.toLowerCase().replace(/\/$/, '')];
  if (target) {
    return redirect('https://' + (CANONICAL_HOST || host) + target + qs);
  }

  // One canonical host (www, the default cloudfront.net name and any alias all redirect to it).
  if (CANONICAL_HOST && host && host !== CANONICAL_HOST) {
    return redirect('https://' + CANONICAL_HOST + uri + qs);
  }

  // /events/foo/  ->  /events/foo/index.html
  if (uri.charAt(uri.length - 1) === '/') {
    request.uri = uri + 'index.html';
    return request;
  }

  // Files with an extension (/_astro/x.css, /robots.txt, /sitemap-index.xml, .ics) pass through.
  if (uri.lastIndexOf('.') > uri.lastIndexOf('/')) {
    return request;
  }

  // /events/foo  ->  /events/foo/  (301, so there is exactly one URL per page)
  return redirect('https://' + (CANONICAL_HOST || host) + uri + '/' + qs);
}
