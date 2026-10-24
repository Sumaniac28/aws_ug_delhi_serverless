// Light unless the user chose dark with the toggle. Runs before first paint; the OS setting is ignored on purpose.
(function () {
  try {
    if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
