// 5. Card-to-page transitions (DESIGN.md, "Motion"). Cross-document View Transitions do the animation (motion.css,
// `@view-transition`); this names the two things that should travel between pages, the title and the picture, so
// the clicked event or speaker grows into the page you land on, and shrinks back on Back.
//
// A classic script in <head> on purpose: `pagereveal` fires before the first render, before deferred modules run.
// External and same-origin, so the strict CSP allows it without a hash. Browsers without the API ignore it.
(function () {
  var NAMES = { title: 'vt-title', image: 'vt-image' };
  var lastLink = null;

  addEventListener(
    'click',
    function (e) {
      lastLink = e.target && e.target.closest ? e.target.closest('a[data-vt-link]') : null;
    },
    true,
  );

  function name(el, n) {
    if (el) el.style.viewTransitionName = n;
  }
  function clearLater(transition, els) {
    transition.finished.finally(function () {
      els.forEach(function (el) {
        if (el) el.style.viewTransitionName = '';
      });
    });
  }
  function pathOf(url) {
    try {
      return new URL(url, location.href).pathname;
    } catch (e) {
      return '';
    }
  }
  // The title and picture of a list entry that links to `path`.
  function sourceFor(path, preferred) {
    var link = preferred && pathOf(preferred.href) === path ? preferred : document.querySelector('a[data-vt-link][href="' + path + '"]');
    if (!link) return null;
    var group = link.closest('[data-vt-group]') || link;
    return {
      title: link.matches('[data-vt-title]') ? link : group.querySelector('[data-vt-title]'),
      image: link.querySelector('[data-vt-image]') || group.querySelector('[data-vt-image]'),
    };
  }
  // The title and picture of a detail page.
  function destination() {
    return { title: document.querySelector('[data-vt-dest="title"]'), image: document.querySelector('[data-vt-dest="image"]') };
  }

  // Leaving this page: name what the visitor clicked, or this page's own title if it is a detail page.
  addEventListener('pageswap', function (e) {
    if (!e.viewTransition || !e.activation || !e.activation.entry) return;
    var to = pathOf(e.activation.entry.url);
    var els = sourceFor(to, lastLink) || destination();
    name(els.title, NAMES.title);
    name(els.image, NAMES.image);
    clearLater(e.viewTransition, [els.title, els.image]);
  });

  // Arriving: a detail page names its own title and picture; a list page (on Back) names the entry we came from.
  addEventListener('pagereveal', function (e) {
    if (!e.viewTransition) return;
    var from = window.navigation && navigation.activation && navigation.activation.from ? pathOf(navigation.activation.from.url) : pathOf(document.referrer);
    var dest = destination();
    var els = dest.title ? dest : (from && sourceFor(from, null)) || dest;
    name(els.title, NAMES.title);
    name(els.image, NAMES.image);
    clearLater(e.viewTransition, [els.title, els.image]);
  });
})();
