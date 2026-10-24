/* Countdown — accounts for a shared copy (several friends on one site).
   Loaded only on copies whose index.html names a site: <meta name="cd-site" content="…">.
   Each friend creates an account with a name and password and logs in on any device; every
   account has its own private vault, so data stays separate. No private links: the vault's key
   stays inside the app and never appears in the address bar. Friends never type an invite code:
   the site's code is sent automatically (since 24 Oct 2026), so a name and password are enough. */

(() => {
  const SITE = (document.querySelector('meta[name="cd-site"]') || {}).content || '';
  if (!SITE || PREVIEW || !Sync.config()) return;

  const INVITE = 'X6CF4M';
  const A = (window.Accounts = { name: LS.get('cd.acct', null), mode: 'login', pwOpen: false });

  const ERR = {
    bad_name: 'Names are 3–20 letters or numbers (you can use . _ and -), with no spaces.',
    bad_password: 'Use a password of at least 6 characters.',
    name_taken: 'That name is already taken. Try another.',
    bad_login: 'That name or password is wrong.',
    full: 'This tracker has no room for more accounts. Ask the friend who sent you the link.',
    closed: 'New accounts can’t be made on this tracker right now.',
    no_account: 'This device isn’t logged in to an account.',
  };
  const errText = (r) => (r.error === 'locked'
    ? `Too many wrong passwords. Try again in ${r.minutes} minute${r.minutes === 1 ? '' : 's'}.`
    : ERR[r.error] || 'Something went wrong. Try again.');

  async function call(fn, body) {
    try {
      return (await Sync.rpc(fn, { p_site: SITE, ...body })) || {};
    } catch (e) {
      return { error: navigator.onLine ? 'server' : 'offline', detail: e.message };
    }
  }
  const failText = (r) => (r.error === 'offline' ? 'You’re offline. Connect to the internet and try again.'
    : r.error === 'server' ? 'Couldn’t reach the server. Try again in a moment.' : errText(r));

  function setName(n) {
    A.name = n || null;
    if (n) LS.set('cd.acct', n); else LS.del('cd.acct');
  }
  // The app writes the vault key into the address bar (#k=…); on this copy it stays hidden.
  function cleanHash() {
    if (/(^#|&)k=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }

  /* ── the log-in screen, shown whenever this device isn't logged in ── */
  function gateHTML() {
    const login = A.mode === 'login';
    return `<div class="acct-card">
      <p class="acct-brand">Countdown</p>
      <h1 id="acctTitle">${login ? 'Log in' : 'Create your account'}</h1>
      <p class="fine">Your IGCSE Feb/March 2027 revision tracker. Every account keeps its own papers, calendar, goals and quiz.</p>
      <div class="seg-ctl acct-tabs" role="radiogroup" aria-label="Log in or create an account">
        <button type="button" role="radio" aria-checked="${login}" data-act="acct-mode" data-m="login">Log in</button>
        <button type="button" role="radio" aria-checked="${!login}" data-act="acct-mode" data-m="signup">Create account</button>
      </div>
      <form class="acct-form" data-form="${login ? 'acct-login' : 'acct-signup'}" novalidate>
        <label class="fld"><span>Name${login ? '' : ' <small class="opt">3–20 letters or numbers, no spaces</small>'}</span><input name="name" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="20" required></label>
        <label class="fld"><span>Password${login ? '' : ' <small class="opt">at least 6 characters</small>'}</span><input name="password" type="password" autocomplete="${login ? 'current-password' : 'new-password'}" maxlength="72" required></label>
        <p class="mf-err" hidden></p>
        <button class="btn primary" type="submit">${login ? 'Log in' : 'Create account'}</button>
      </form>
      <p class="fine acct-foot">${login ? 'New here? Tap <b>Create account</b> above.' : 'Remember your name and password. You’ll use them to log in on your other devices.'}</p>
    </div>`;
  }
  function showGate() {
    let g = document.getElementById('acctGate');
    if (!g) {
      g = document.createElement('div');
      g.id = 'acctGate';
      g.className = 'acct-gate';
      g.setAttribute('role', 'dialog');
      g.setAttribute('aria-modal', 'true');
      g.setAttribute('aria-labelledby', 'acctTitle');
      document.body.appendChild(g);
    }
    g.innerHTML = gateHTML();
    document.body.classList.add('acct-locked');
  }
  function hideGate() {
    const g = document.getElementById('acctGate');
    if (g) g.remove();
    document.body.classList.remove('acct-locked');
  }
  A.showGate = showGate;

  function formError(f, text) {
    const e = f.querySelector('.mf-err');
    e.textContent = text;
    e.hidden = false;
  }
  function busy(f, on) {
    const b = f.querySelector('button[type="submit"]');
    if (!b) return;
    if (on) { b.dataset.label = b.textContent; b.textContent = 'One moment…'; b.disabled = true; } else { b.textContent = b.dataset.label || b.textContent; b.disabled = false; }
  }

  async function openTracker(secret, name) {
    const ok = await connectWith(secret, { quiet: true });
    cleanHash();
    if (!ok && !Sync.key) return false;
    setName(name);
    hideGate();
    render();
    toast(`Welcome, ${name}.`);
    return true;
  }

  /* ── Sync tab: account box on top; the private-link controls are left out on this copy ── */
  function accountHTML() {
    const who = A.name ? `Logged in as <b>${esc(A.name)}</b>.` : 'You’re logged in on this device.';
    return `<div class="view-head"><h2 class="h">Account</h2></div><section class="block acct-box">
      <p>${who} Log in with your name and password on any phone, tablet or computer to see the same tracker.</p>
      <div class="btn-row"><button class="btn" data-act="acct-pw" aria-expanded="${A.pwOpen}">Change password</button><button class="btn" data-act="acct-logout">Log out of this device</button></div>
      ${A.pwOpen ? `<form class="acct-form acct-inline" data-form="acct-pw" novalidate>
        <label class="fld grow"><span>New password <small class="opt">at least 6 characters</small></span><input name="password" type="password" autocomplete="new-password" maxlength="72" required></label>
        <button class="btn primary" type="submit">Save</button><p class="mf-err" hidden></p></form>` : ''}
    </section>`;
  }
  const baseRenderData = window.renderData;
  window.renderData = function renderDataWithAccount() {
    baseRenderData();
    if (!Sync.key) return;
    const el = document.getElementById('v-data');
    if (!el) return;
    const card = el.querySelector('.sync-card');
    if (card) {
      const status = card.querySelector('.sync-status');
      card.innerHTML = '';
      if (status) card.appendChild(status);
      card.insertAdjacentHTML('beforeend', '<p>Everything you do is saved to your account, so it’s the same on every device you log in on.</p><div class="btn-row"><button class="btn" data-act="sync-now">Sync now</button></div>');
    }
    const disc = el.querySelector('[data-act="disconnect"]');
    if (disc && disc.closest('li')) disc.closest('li').remove();
    el.insertAdjacentHTML('afterbegin', accountHTML());
  };

  /* ── events ── */
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act^="acct-"]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'acct-mode') { A.mode = el.dataset.m; showGate(); const i = document.querySelector('#acctGate input[name="name"]'); if (i) i.focus(); }
    if (act === 'acct-pw') { A.pwOpen = !A.pwOpen; renderData(); }
    if (act === 'acct-logout') {
      confirmTap(el, async () => {
        if (Store.dirty.size) await Sync.syncNow();
        if (Store.dirty.size) { toast('Some changes haven’t synced yet. Connect to the internet first, so nothing is lost.'); return; }
        Sync.disconnect();
        Store.wipe();
        setName(null);
        cleanHash();
        rebuild();
        render();
        A.mode = 'login';
        showGate();
      }, 'Tap again to log out');
    }
  });

  document.addEventListener('submit', async (ev) => {
    const f = ev.target;
    const kind = f.dataset && f.dataset.form;
    if (!kind || !kind.startsWith('acct-')) return;
    ev.preventDefault();
    if (kind === 'acct-login' || kind === 'acct-signup') {
      const name = f.elements.namedItem('name').value.trim(), password = f.elements.namedItem('password').value;
      if (!name || !password) { formError(f, 'Fill in your name and password.'); return; }
      busy(f, true);
      const r = await call(kind === 'acct-login' ? 'cd_login' : 'cd_signup', kind === 'acct-login' ? { p_name: name, p_password: password } : { p_invite: INVITE, p_name: name, p_password: password });
      if (r.error || !r.secret) { busy(f, false); formError(f, failText(r)); return; }
      await openTracker(r.secret, r.name || name);
      return;
    }
    if (kind === 'acct-pw') {
      busy(f, true);
      const r = await call('cd_set_password', { p_secret: Sync.key, p_password: f.elements.namedItem('password').value });
      busy(f, false);
      if (r.error) { formError(f, failText(r)); return; }
      A.pwOpen = false;
      renderData();
      toast('Password changed.');
    }
  });

  /* Show the log-in screen whenever this device isn't logged in (first visit, after logging out). */
  let gateTimer = null;
  Sync.onChange(() => {
    clearTimeout(gateTimer);
    if (Sync.key && Sync.status === 'error' && /not recognised/.test(Sync.message)) {
      // the account behind this device was removed: log out and start again
      Sync.disconnect();
      Store.wipe();
      setName(null);
      rebuild();
      render();
      A.mode = 'login';
      showGate();
      toast('That account no longer exists. Log in or create a new one.');
      return;
    }
    if (Sync.key) { hideGate(); return; }
    gateTimer = setTimeout(() => { if (!Sync.key) { setName(null); showGate(); } }, 400);
  });

  cleanHash();
  if (!Sync.key) showGate();
  else {
    if (ui.tab === 'data') renderData();
    if (!A.name) {
      call('cd_whoami', { p_secret: Sync.key }).then((r) => { if (r && r.name) { setName(r.name); if (ui.tab === 'data') renderData(); } });
    }
  }
})();
