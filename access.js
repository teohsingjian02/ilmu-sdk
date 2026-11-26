function localizeLabels(root, language) {
  const english = language === 'en-GB';
  root.querySelectorAll('[data-ms][data-en]').forEach(el => {
    el.textContent = english ? el.dataset.en : el.dataset.ms;
  });
  root.querySelectorAll('[data-ms-placeholder][data-en-placeholder]').forEach(el => {
    el.placeholder = english ? el.dataset.enPlaceholder : el.dataset.msPlaceholder;
  });
}

(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const gate = byId('access-gate');
  const studio = byId('studio');
  const language = byId('language');
  const password = byId('access-password');
  const submit = byId('access-submit');
  const feedback = byId('access-feedback');
  const messages = {
    wrong: ['Kata laluan salah. Cuba lagi.', 'Incorrect password. Try again.'],
    expired: ['Sesi anda telah tamat. Masukkan kata laluan semula.', 'Your session has expired. Enter the password again.'],
    busy: ['Terlalu banyak percubaan. Cuba sebentar lagi.', 'Too many attempts. Please try again later.'],
    connecting: ['Sedang menyambung…', 'Connecting…'],
    unavailable: ['Pelayan demo tidak dapat dihubungi. Cuba lagi.', 'The demo server could not be reached. Try again.'],
    config: ['Konfigurasi demo tidak tersedia. Muat semula halaman.', 'The demo configuration is unavailable. Reload the page.'],
    load: ['Demo gagal dimuatkan. Muat semula halaman.', 'The demo could not load. Reload the page.']
  };
  let feedbackKey = '';
  let session = null;
  let expiryTimer;
  let studioLoading;
  let chatUrl;

  function updateGate(key = feedbackKey) {
    feedbackKey = key;
    const english = language.value === 'en-GB';
    document.documentElement.lang = english ? 'en' : 'ms';
    localizeLabels(document.querySelector('header'), language.value);
    localizeLabels(gate, language.value);
    feedback.textContent = messages[key]?.[english ? 1 : 0] || '';
  }

  function lock(reason) {
    session = null;
    clearTimeout(expiryTimer);
    window.dispatchEvent(new Event('ilmu-session-locked'));
    if (byId('character-dialog').open) byId('character-dialog').close();
    studio.hidden = true;
    byId('skip-study').hidden = true;
    gate.hidden = false;
    password.value = '';
    password.focus();
    updateGate(reason);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

  async function openStudio() {
    if (!studioLoading) localizeLabels(studio, language.value);
    gate.hidden = true;
    studio.hidden = false;
    byId('skip-study').hidden = false;
    if (!studioLoading) {
      for (const img of studio.querySelectorAll('img[data-src]')) img.src = img.dataset.src;
      studioLoading = Promise.all([loadScript('ilmu-avatar.js'), loadScript('study-data.js')])
        .then(() => loadScript('console.js'));
    }
    try {
      await studioLoading;
    } catch {
      lock('load');
      submit.disabled = true;
    }
  }

  async function chat(payload, signal) {
    const current = session;
    if (!current || current.expiresAt <= Date.now()) {
      lock('expired');
      throw new Error('Session expired');
    }
    const response = await fetch(chatUrl.href, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + current.token},
      body: JSON.stringify(payload),
      signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
    });
    if (response.status === 401 && session === current) lock('expired');
    if (!response.ok) throw new Error('Chat request failed (' + response.status + ')');
    return response.json();
  }

  language.value = new URLSearchParams(location.search).get('language') === 'ms-MY' ? 'ms-MY' : 'en-GB';
  language.addEventListener('change', () => { if (!gate.hidden) updateGate(); });
  const endpoint = window.ILMU_STUDIO_CONFIG?.speechEndpoint;
  if (endpoint === '') {
    openStudio();
    return;
  }
  try {
    chatUrl = new URL(endpoint);
    if (chatUrl.protocol !== 'https:' || chatUrl.username || chatUrl.password ||
        chatUrl.hash || chatUrl.search || !chatUrl.pathname.endsWith('/api/chat')) throw new Error();
  } catch {
    lock('config');
    password.disabled = true;
    submit.disabled = true;
    return;
  }

  // The token lives only in this page's memory. The transport always targets the configured chat URL.
  window.ILMUAccess = Object.freeze({endpoint: chatUrl.href, chat});
  byId('ai-connection').hidden = true;
  const sessionUrl = new URL('session', chatUrl);
  byId('access-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || !password.value) return;
    submit.disabled = true;
    updateGate('connecting');
    try {
      const response = await fetch(sessionUrl, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password: password.value}), redirect: 'error', credentials: 'omit',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(60000)
      });
      password.value = '';
      if (!response.ok) {
        updateGate(response.status === 401 || response.status === 403 ? 'wrong' : response.status === 429 ? 'busy' : 'unavailable');
        return;
      }
      const result = await response.json();
      if (typeof result.token !== 'string' || !result.token ||
          !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error();
      session = {token: result.token, expiresAt: result.expiresAt};
      expiryTimer = setTimeout(() => lock('expired'), Math.min(result.expiresAt - Date.now(), 2147483647));
      updateGate('');
      await openStudio();
    } catch {
      password.value = '';
      updateGate('unavailable');
    } finally {
      submit.disabled = feedbackKey === 'load';
      if (!gate.hidden) password.focus();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && session && session.expiresAt <= Date.now()) lock('expired');
  });
  lock('');
})();
