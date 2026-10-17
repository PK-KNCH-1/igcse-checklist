/* Countdown — accounts for a shared copy (several friends on one site).
   Loaded only on copies whose index.html names a site: <meta name="cd-site" content="…">.
   An account is a name and password that unlock one private link (vault); each friend's data stays
   separate. New accounts need the site's invite code. Private links keep working as before. */

(() => {
  const SITE = (document.querySelector('meta[name="cd-site"]') || {}).content || '';
  if (!SITE || PREVIEW || !Sync.config()) return;

  const A = (window.Accounts = { name: LS.get('cd.acct', null), mode: 'login', pwOpen: false });

  const ERR = {
    bad_invite: 'That invite code isn’t right. Ask the friend who sent you the link.',
    bad_name: 'Names are 3–20 letters or numbers (you can use . _ and -), with no spaces.',
    bad_password: 'Use a password of at least 6 characters.',
    name_taken: 'That name is already taken. Try another.',
    bad_login: 'That name or password is wrong.',
    full: 'This tracker has no room for more accounts. Ask the friend who sent you the link.',
    has_account: 'This tracker already has a login.',
    unknown_vault: 'This tracker can’t be given a login.',
    no_account: 'This tracker doesn’t have a login yet.',
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

  /* ── the log-in screen, shown whenever this device has no tracker open ── */
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
        <label class="fld"><span>Name</span><input name="name" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="20" required></label>
        <label class="fld"><span>Password${login ? '' : ' <small class="opt">at least 6 characters</small>'}</span><input name="password" type="password" autocomplete="${login ? 'current-password' : 'new-password'}" maxlength="72" required></label>
        ${login ? '' : '<label class="fld"><span>Invite code <small class="opt">from the friend who sent you the link</small></span><input name="invite" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" required></label>'}
        <p class="mf-err" hidden></p>
        <button class="btn primary" type="submit">${login ? 'Log in' : 'Create account'}</button>
      </form>
      <details class="acct-link"><summary>I have a private link instead</summary>
        <form class="acct-form" data-form="acct-link" novalidate>
          <label class="fld"><span>Private link</span><input name="link" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…#k=…"></label>
          <p class="mf-err" hidden></p>
          <button class="btn" type="submit">Open my tracker</button>
        </form>
      </details>
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
    if (!ok && !Sync.key) return false;
    setName(name);
    hideGate();
    render();
    toast(name ? `Welcome, ${name}.` : 'Your tracker is open.');
    return true;
  }

  /* ── account box at the top of the Sync tab ── */
  function accountHTML() {
    let body;
    if (A.name) {
      body = `<p>Logged in as <b>${esc(A.name)}</b>. Log in with your name and password on any phone, tablet or computer.</p>
        <div class="btn-row"><button class="btn" data-act="acct-pw" aria-expanded="${A.pwOpen}">Change password</button><button class="btn" data-act="acct-logout">Log out of this device</button></div>
        ${A.pwOpen ? `<form class="acct-form acct-inline" data-form="acct-pw" novalidate>
          <label class="fld grow"><span>New password</span><input name="password" type="password" autocomplete="new-password" maxlength="72" required></label>
          <button class="btn primary" type="submit">Save</button><p class="mf-err" hidden></p></form>` : ''}`;
    } else {
      body = `<p>Add a name and password, so you can open this tracker on other devices by logging in instead of using the private link.</p>
        <form class="acct-form acct-inline" data-form="acct-attach" novalidate>
          <label class="fld"><span>Name</span><input name="name" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="20" required></label>
          <label class="fld"><span>Password <small class="opt">at least 6 characters</small></span><input name="password" type="password" autocomplete="new-password" maxlength="72" required></label>
          <button class="btn primary" type="submit">Add login</button><p class="mf-err" hidden></p></form>`;
    }
    return `<div class="view-head"><h2 class="h">Account</h2></div><section class="block acct-box">${body}</section>`;
  }
  const baseRenderData = window.renderData;
  window.renderData = function renderDataWithAccount() {
    baseRenderData();
    if (!Sync.key) return;
    const el = document.getElementById('v-data');
    if (el) el.insertAdjacentHTML('afterbegin', accountHTML());
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
        history.replaceState(null, '', location.pathname);
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
    const val = (n) => { const i = f.elements.namedItem(n); return i ? i.value.trim() : ''; };
    if (kind === 'acct-link') {
      const key = parseKeyFromLink(val('link'));
      if (!key) { formError(f, 'Paste the whole private link. It ends with #k= followed by a long code.'); return; }
      busy(f, true);
      const ok = await connectWith(key, { quiet: true });
      busy(f, false);
      if (!ok && !Sync.key) return;
      const who = await call('cd_whoami', { p_secret: key });
      setName(who.name || null);
      hideGate();
      render();
      toast('Your tracker is open.');
      return;
    }
    if (kind === 'acct-login' || kind === 'acct-signup') {
      const name = val('name'), password = f.elements.namedItem('password').value;
      if (!name || !password) { formError(f, 'Fill in your name and password.'); return; }
      busy(f, true);
      const r = kind === 'acct-login'
        ? await call('cd_login', { p_name: name, p_password: password })
        : await call('cd_signup', { p_invite: val('invite'), p_name: name, p_password: password });
      if (r.error || !r.secret) { busy(f, false); formError(f, failText(r)); return; }
      await openTracker(r.secret, r.name || name);
      return;
    }
    if (kind === 'acct-attach') {
      const name = val('name'), password = f.elements.namedItem('password').value;
      busy(f, true);
      const r = await call('cd_attach', { p_secret: Sync.key, p_name: name, p_password: password });
      busy(f, false);
      if (r.error) { formError(f, failText(r)); return; }
      setName(r.name || name);
      renderData();
      toast(`Login added. Log in as ${A.name} on your other devices.`);
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

  /* Show the log-in screen whenever no tracker is open (first visit, after logging out or disconnecting). */
  let gateTimer = null;
  Sync.onChange(() => {
    clearTimeout(gateTimer);
    if (Sync.key) { hideGate(); return; }
    gateTimer = setTimeout(() => { if (!Sync.key) { setName(null); showGate(); } }, 400);
  });

  if (!Sync.key && !parseKeyFromLink(location.hash)) showGate();
  else {
    if (ui.tab === 'data') renderData();
    if (Sync.key && !A.name) {
      call('cd_whoami', { p_secret: Sync.key }).then((r) => { if (r && r.name) { setName(r.name); if (ui.tab === 'data') renderData(); } });
    }
  }
})();
