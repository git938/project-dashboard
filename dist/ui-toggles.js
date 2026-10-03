/* Small UI toggles that live outside the generated app bundle.
 *
 * Currently one: show/hide the task duration end marker drawn on timeline pills
 * and Gantt bars (see the ::after rule at the end of planning.css). The choice
 * is kept in localStorage and applied as a class on <html>, because the app
 * replaces the innerHTML of every panel on each render -- a class on <html>
 * survives that, a class on a panel does not.
 */
(function () {
  'use strict';
  var KEY = 'pw-duration-tick';
  var OFF_CLASS = 'no-duration-tick';
  var BOX_ID = 'duration-tick-toggle';

  function isOn() {
    try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; }
  }
  function apply() {
    var on = isOn();
    document.documentElement.classList.toggle(OFF_CLASS, !on);
    var box = document.getElementById(BOX_ID);
    if (box) box.checked = on;
  }
  document.addEventListener('change', function (e) {
    if (!e.target || e.target.id !== BOX_ID) return;
    try { localStorage.setItem(KEY, e.target.checked ? 'on' : 'off'); } catch (err) {}
    apply();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
