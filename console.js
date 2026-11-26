/* ILMU study companion. Only the public SDK API is used; keys stay on the server. */
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const buildUrl = 'Build';
let language = $('language').value;
let subject = 'sejarah', scenario = null, scenarioIndex = 0, practiceIndex = 0, selectedQuestion = null;
const t = (ms, en) => language === 'ms-MY' ? ms : en;
const local = item => item[language === 'ms-MY' ? 'ms' : 'en'];
let ready = false, speechId = 0, loadId = 0, captionTimer, busy = false, modelLoading = false;
let characterEntries = [], catalogue = {}, activeClip = null, phase = 'loading';
let recognition = null, micOn = false, micStarting = false, micError = false;
let exchange = null, speechKind = null, liveReply = null;
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecognize = !!Recognition && window.isSecureContext;
$('endpoint').value = window.ILMU_STUDIO_CONFIG?.speechEndpoint || '';
function speechEndpoint() {
  if (window.ILMUAccess) return window.ILMUAccess.endpoint;
  try {
    const url = new URL($('endpoint').value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
$('language').value = language;
function notice(text = '') { $('notice-text').textContent = text; $('notice').hidden = !text; }
$('dismiss-notice').onclick = () => notice();
function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el; }
function seconds(ms) { return (Math.max(0, ms) / 1000).toFixed(1) + ' s'; }
function setPhase(value) {
  phase = value;
  const labels = {
    loading:['Menyediakan avatar','Preparing avatar'], idle:['Sedia belajar','Ready to learn'],
    listening:['Mendengar','Listening'], thinking:['Sedang berfikir','Thinking'], talking:['Sedang bercakap','Speaking'],
    opening:['Membuka model','Opening character'], error:['Sila cuba semula','Please try again']
  };
  const text = labels[value] || labels.idle;
  $('status').textContent = t(...text);
  $('status').className = 'status ' + (['thinking','talking','opening','listening'].includes(value) ? 'busy' : value === 'error' ? 'error' : '');
}
function setBody(state) { if (ready) avatar.setState(state); }
function controlsBusy(value) {
  busy = value;
  ['preview-sample','sample','tone','tone-plain'].forEach(id => $(id).disabled = value || modelLoading || !ready);
  $('speak').disabled = value || (Boolean(speechEndpoint()) && (modelLoading || !ready));
  $('mic').disabled = !ready || !canRecognize || modelLoading;
  updateStop();
}
function updateStop(){const active=busy||micOn||micStarting;$('stop').hidden=!active;$('stop').disabled=!ready||!active;}
function selectTab(name) {
  if(name!=='talk')stopRecognition(true);
  document.querySelectorAll('[data-tab]').forEach(b => {
    const active = b.dataset.tab === name; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1;
    $('panel-' + b.dataset.tab).hidden = !active;
  });
}
const tabs = [...document.querySelectorAll('[data-tab]')];
tabs.forEach((b,i) => {
  b.onclick = () => selectTab(b.dataset.tab);
  b.onkeydown = e => {
    const next = e.key === 'ArrowRight' ? (i+1)%tabs.length : e.key === 'ArrowLeft' ? (i+tabs.length-1)%tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length-1 : null;
    if (next !== null) { e.preventDefault(); selectTab(tabs[next].dataset.tab); tabs[next].focus(); }
  };
});
const avatar = new ILMUAvatar('#avatar', {
  buildUrl, speechEndpoint:speechEndpoint(), backgroundColor:'transparent', framing:'head', lookAtCamera:true, language,
  width:640, height:500,
  onProgress:p => { if ($('loading-text')) $('loading-text').textContent = t('Menyediakan avatar… ','Preparing avatar… ') + Math.round(p*100) + '%'; }
});
window.avatar = avatar;
avatar.on('error', message => console.warn('ILMU:', message));
avatar.on('avatarLoaded', () => { $('empty').hidden = true; });
function showSpeechText(text) {
  clearTimeout(captionTimer);
  if (speechKind === 'live' && exchange && !exchange.endAt) {
    $('caption').hidden=true;
    exchange.textAt = performance.now();
    if (!liveReply) liveReply = addMessage('ILMU',text,'reply'); else liveReply.querySelector('p').textContent = text;
    renderExchange();
  }else{$('caption').textContent=text;$('caption').hidden=!text;}
}
avatar.on('speechText', showSpeechText);
avatar.on('speechStarted', () => {
  setPhase('talking');
  if (speechKind === 'live' && exchange && !exchange.endAt) { exchange.audioAt = performance.now(); exchange.status = 'speaking'; renderExchange(); }
});
avatar.on('speechFinished', () => {
  captionTimer = setTimeout(() => { $('caption').hidden = true; }, 5000);
  if (speechKind === 'live' && exchange && exchange.audioAt && !exchange.audioEndAt) exchange.audioEndAt = performance.now();
  if (!micOn) setPhase('idle'); renderExchange();
});
function markClip(name) {
  activeClip = name;
  document.querySelectorAll('[data-clip]').forEach(b => { const on = b.dataset.clip === name; b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on)); });
}
avatar.on('animationStarted', name => { markClip(name); $('animation-status').textContent = t('Sedang dimainkan: ','Playing: ') + name; });
avatar.on('animationFinished', name => { if (activeClip === name) { markClip(null); $('animation-status').textContent = t('Selesai: ','Finished: ') + name; } });
function characterName(entry) { return entry.name || entry.id; }
function renderCharacters() {
  $('avatars').replaceChildren();
  characterEntries.forEach(entry => {
    const b = node('button','portrait-card'); b.type = 'button'; b.dataset.character = entry.id;
    const picture = node('span','portrait-image');
    picture.append(node('span','portrait-fallback',characterName(entry).split(/\s+/).map(s=>s[0]).slice(0,2).join('')));
    const img = document.createElement('img'); img.src = `portraits/${encodeURIComponent(entry.id)}.png`; img.alt = ''; img.loading = 'lazy';
    img.onerror = () => img.remove(); picture.append(img);
    b.append(picture,node('span','portrait-name',characterName(entry)),node('span','portrait-check','✓'));
    b.onclick = () => load(entry.id,characterName(entry)); b.disabled = !ready || modelLoading; $('avatars').append(b);
  });
  syncCharacter();
}
function activeCharacter() {
  const id = avatar.currentAvatarId;
  return characterEntries.find(entry => {
    if (entry.id === id) return true;
    try { return entry.url && new URL(entry.url,new URL(buildUrl+'/',location.href)).href === new URL(id,location.href).href; } catch { return false; }
  });
}
function syncCharacter() {
  const listed = activeCharacter();
  document.querySelectorAll('[data-character]').forEach(b => { const on = b.dataset.character === listed?.id; b.setAttribute('aria-pressed',String(on)); b.classList.toggle('on',on); });
}
$('choose-character').onclick=()=>{stopRecognition(true);$('character-dialog').showModal();};
$('close-characters').onclick=()=>$('character-dialog').close();
$('character-dialog').addEventListener('click',event=>{if(event.target===$('character-dialog')){const box=event.target.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)event.target.close();}});
avatar.init().then(async () => {
  avatar.setLanguage(language); avatar.setFraming('head');
  const list = await avatar.getAvatars();
  catalogue = await fetch(buildUrl+'/ilmu-build.json').then(r=>{if(!r.ok)throw Error('Catalogue');return r.json();}).catch(()=>({avatars:list}));
  characterEntries = catalogue.avatars || list;
  const requested = characterEntries.find(entry => entry.id === params.get('character'));
  if (requested && requested.id !== avatar.currentAvatarId) await avatar.loadAvatar(requested.id);
  renderCharacters(); $('empty').hidden = !!avatar.currentAvatarId;
  await Promise.all([buildAnimations(),buildGestures()]);
  ready = true; $('loading')?.remove(); controlsBusy(false);
  ['demo-character','load-url'].forEach(id=>$(id).disabled=false);
  document.querySelectorAll('[data-character]').forEach(b=>b.disabled=false);
  if(phase==='loading')setPhase('idle');
  updateMic();
}).catch(error => {
  console.warn('ILMU init:',error.message); setPhase('error');
  if ($('loading-text')) $('loading-text').textContent = t('Avatar tidak dapat dimuatkan. Latihan teks masih tersedia.','The avatar could not load. Text practice is still available.');
  controlsBusy(false);
});
async function buildAnimations() {
  let names = await avatar.getAnimations(); const allowed = catalogue.studio?.allowedAnimations;
  if (Array.isArray(allowed)) names = names.filter(name=>allowed.includes(name));
  $('animation-clips').replaceChildren(); $('animation-count').textContent = names.length + t(' gerakan dipilih untuk belajar.',' movements selected for study.');
  names.forEach(name => {
    const b = node('button','animation-card'); b.dataset.clip=name; b.setAttribute('aria-pressed','false');
    b.append(node('span','clip-play','▶'),node('span','',name));
    b.onclick = () => { if (busy || micOn || micStarting) return notice(t('Hentikan pertuturan atau mikrofon dahulu.','Stop speech or the microphone first.')); avatar.playAnimation(name); };
    $('animation-clips').append(b);
  });
  $('stop-animation').disabled = names.length === 0;
}
async function buildGestures() {
  let ids = await avatar.getGestures(); const allowed = catalogue.studio?.allowedGestures;
  if (Array.isArray(allowed)) ids = ids.filter(id=>allowed.includes(id));
  $('gestures').replaceChildren();
  ids.forEach(id => { const b=node('button','secondary',id==='nod'?t('Angguk','Nod'):id); b.dataset.gesture=id; b.onclick=()=>avatar.playAnimation(id); $('gestures').append(b); });
}
$('stop-animation').onclick = () => { avatar.stopAnimation(); if (!busy && !micOn) setBody('idle'); markClip(null); $('animation-status').textContent=t('Gerakan dihentikan.','Movement stopped.'); };
const requestedTab = params.get('tab');
selectTab(['talk','practice','session','settings'].includes(requestedTab) ? requestedTab : speechEndpoint() ? 'talk' : 'practice');

function choosePrompt(q) {
  $('guided-topic').value = q.id;
  $('message').value = local(q).question;
}
function renderAsk() {
  const offline = !speechEndpoint();
  const select = $('guided-topic'), previous = select.value;
  $('guided-questions').hidden = !offline;
  $('talk-title').textContent = offline ? t('Soalan berpandu','Guided questions') : t('Tanya ILMU','Ask ILMU');
  $('speak').textContent = offline ? t('Lihat jawapan','Show answer') : t('Tanya ILMU','Ask ILMU');
  $('message').placeholder = offline ? t('Pilih topik atau sebut nama topik.','Choose a topic or say its name.') : t('Apa yang ingin anda fahami?','What would you like to understand?');
  select.replaceChildren(new Option(t('Pilih topik','Choose a topic'),''));
  ILMU_STUDY.questions.forEach(q => select.add(new Option(local(q.topic).split(' • ')[0],q.id)));
  select.value = previous;
  controlsBusy(busy);
}
$('guided-topic').onchange = () => {
  const q = ILMU_STUDY.questions.find(item => item.id === $('guided-topic').value);
  if (q) choosePrompt(q); else $('message').value = '';
  notice();
};
function matchPrompt(text) {
  const normalize = str => str.normalize('NFKC').toLocaleLowerCase().replace(/[.,!?;:]/g,'').replace(/\s+/g,' ').trim();
  const input = normalize(text);
  return ILMU_STUDY.questions.find(q => [q.en.question,q.ms.question,q.topic.ms.split(' • ')[0],q.topic.en.split(' • ')[0]].some(label => normalize(label) === input));
}
function renderPractice() {
  $('practice-questions').replaceChildren();
  const questions=ILMU_STUDY.questions.filter(q=>q.subject===subject);
  practiceIndex=Math.max(0,Math.min(practiceIndex,questions.length-1));
  const q=questions[practiceIndex];
  if(q){
    const card=node('article','practice-card');
    card.append(node('span','question-topic',local(q.topic)),node('p','question-text',local(q).question));
    const actions=node('div','practice-actions');
    const reveal=node('button','secondary',t('Lihat jawapan','View answer')); reveal.onclick=()=>showAnswer(q);
    actions.append(reveal);
    if (speechEndpoint()) {
      const ask=node('button','primary',t('Tanya ILMU','Ask ILMU')); ask.onclick=()=>{choosePrompt(q);selectTab('talk');$('message').focus();};
      actions.append(ask);
    }
    card.append(actions);$('practice-questions').append(card);
  }
  $('practice-position').textContent=`${practiceIndex+1} / ${questions.length}`;
  $('practice-prev').disabled=practiceIndex===0;
  $('practice-next').disabled=practiceIndex>=questions.length-1;
  document.querySelectorAll('[data-subject]').forEach(b=>{const on=b.dataset.subject===subject;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
}
function changePractice(delta){practiceIndex+=delta;selectedQuestion=null;$('worked-answer').hidden=true;renderPractice();}
$('practice-prev').onclick=()=>changePractice(-1);
$('practice-next').onclick=()=>changePractice(1);
function showAnswer(q) {
  selectedQuestion=q;const data=local(q);$('worked-answer').hidden=false;$('answer-question').textContent=data.question;$('answer-steps').replaceChildren();
  data.answer.forEach(step=>$('answer-steps').append(node('li','',step)));$('answer-check').textContent=data.check;$('answer-sources').replaceChildren();
  const sources=q.id==='merdeka-malaysia'?[
    ['Arkib Negara: Perisytiharan Kemerdekaan','https://pustakailmu.arkib.gov.my/index.php/ms/pustaka-ilmu/imbasan-fakta/dokumen-perisytiharan-kemerdekaan'],
    ['Arkib Negara: Penubuhan Malaysia','https://pustakailmu.arkib.gov.my/index.php/ms/pustaka-ilmu/jendela-sejarah/penubuhan-malaysia-16-september-1963']
  ]:q.id==='malayan-union'?[[t('Rujukan fakta: Huraian Sukatan Pelajaran Sejarah (arkib)','Fact reference: History curriculum (archive)'),'https://ipim.jmm.gov.my/sites/default/files/dockokurikulum/hsp_f3.pdf']]:[];
  sources.forEach(([title,href])=>{const a=node('a','',title+'');a.href=href;a.target='_blank';a.rel='noopener';$('answer-sources').append(a);});
}
document.querySelectorAll('[data-subject]').forEach(b=>b.onclick=()=>{subject=b.dataset.subject;practiceIndex=0;selectedQuestion=null;$('worked-answer').hidden=true;renderPractice();});
function scenarioDescription(item){
  const descriptions={
    'quick-revision':['Pelajar Tingkatan 5 yang mahu mengingat fakta penting dan menguji kefahaman Sejarah.','A Form 5 learner reviewing key History facts and checking understanding.'],
    'step-by-step':['Pelajar Tingkatan 4 yang mahu memahami setiap langkah penyelesaian Matematik.','A Form 4 learner who wants to understand each step in Mathematics.'],
    'voice-practice':['Pelajar Tingkatan 5 yang suka bertanya dan menerangkan idea dengan suara.','A Form 5 learner who prefers asking and explaining ideas aloud.']
  };
  return t(...(descriptions[item.id]||['Belajar mengikut cara anda.','Learn in your own way.']));
}
function renderScenarios() {
  $('scenarios').replaceChildren();
  const item=ILMU_STUDY.scenarios[scenarioIndex];
  const card=node('article','scenario-card');card.dataset.scenario=item.id;
  const icon=node('span','scenario-initial',item.initials),body=node('div','scenario-body');
  body.append(node('h3','',`${item.name} · ${local(item).title}`),node('p','',scenarioDescription(item)));
  const use=node('button','primary',t('Gunakan senario','Use scenario'));
  use.onclick=()=>{
    scenario=item;subject=item.subject;practiceIndex=0;selectedQuestion=null;$('worked-answer').hidden=true;renderPractice();
    if(item.id==='voice-practice'){selectTab('talk');if(!speechEndpoint()){$('guided-topic').value='';$('message').value='';}$('message').focus();}else selectTab('practice');
  };
  body.append(use);card.append(icon,body);$('scenarios').append(card);
  $('study-goal').textContent=local(item).goal;
  $('scenario-position').textContent=`${scenarioIndex+1} / ${ILMU_STUDY.scenarios.length}`;
  $('scenario-prev').disabled=scenarioIndex===0;
  $('scenario-next').disabled=scenarioIndex>=ILMU_STUDY.scenarios.length-1;
}
$('scenario-prev').onclick=()=>{scenarioIndex=Math.max(0,scenarioIndex-1);renderScenarios();};
$('scenario-next').onclick=()=>{scenarioIndex=Math.min(ILMU_STUDY.scenarios.length-1,scenarioIndex+1);renderScenarios();};
function addMessage(who,text,kind) {
  const article=node('article','chat-message '+kind);article.append(node('span','chat-label',who),node('p','',text));$('conversation').append(article);
  while($('conversation').children.length>16)$('conversation').firstChild.remove();$('conversation').scrollTop=$('conversation').scrollHeight;return article;
}
function renderExchange() {
  $('exchange-details').hidden=!exchange;
  if(!exchange)return;
  const root=$('exchange-steps');root.replaceChildren();const now=performance.now();
  const end=exchange.endAt||now,waitEnd=exchange.audioAt||exchange.endAt||now;
  const steps=[
    {label:t('Menunggu jawapan','Preparing reply'),value:seconds(waitEnd-exchange.sentAt),note:exchange.audioAt?t('hingga audio bermula','until audio began'):exchange.endAt?t('permintaan berakhir','request ended'):t('sedang menunggu','waiting')},
    {label:t('Audio','Audio'),value:exchange.audioAt?seconds((exchange.audioEndAt||exchange.endAt||now)-exchange.audioAt):'—',note:exchange.audioAt?t('tempoh dimainkan','time played'):t('belum dimainkan','not played')},
    {label:t('Jumlah','Total'),value:seconds(end-exchange.sentAt),note:t('sejak hantar','since send')}
  ];
  $('exchange-tag').textContent=exchange.status==='cancelled'?t('Dihentikan','Stopped'):exchange.status==='error'?t('Gagal','Failed'):exchange.endAt?t('Diukur','Measured'):t('Sedang diukur','Measuring');
  $('exchange-note').textContent=t('Masa sebenar termasuk AI, penjanaan suara dan rangkaian.','Actual time includes AI, voice generation and network.');
  steps.forEach(step=>{const el=node('div','exchange-step');el.append(node('span','',step.label),node('strong','',step.value),node('small','',step.note));root.append(el);});
}
function finishExchange(status) {
  if(!exchange||exchange.endAt)return;
  exchange.endAt=performance.now();exchange.status=status;
  if(exchange.audioAt&&!exchange.audioEndAt)exchange.audioEndAt=exchange.endAt;
  renderExchange();
}
async function performSpeech(operation,kind) {
  stopRecognition(true);avatar.stopAnimation();const id=++speechId;speechKind=kind;notice();clearTimeout(captionTimer);controlsBusy(true);
  if(kind==='live'){$('caption').hidden=true;setBody('thinking');setPhase('thinking');}else{setBody('idle');setPhase('idle');}
  try { await operation(id);if(id===speechId&&kind==='live')finishExchange('complete'); }
  catch(error){
    if(id!==speechId)return;console.warn('ILMU speech:',error.message);if(kind==='live')finishExchange('error');
    notice(t('Respons tidak dapat dimainkan. Cuba latihan teks atau sampel suara; semak sambungan AI dalam Studio.','The reply could not play. Try text practice or the voice sample, and check the AI connection in Studio.'));setPhase('error');
  }finally{if(id===speechId){speechKind=null;controlsBusy(false);setBody('idle');if($('notice').hidden)setPhase('idle');}}
}
$('speak').onclick=()=>{
  const message=$('message').value.trim();
  if (!speechEndpoint()) {
    stopRecognition(true);
    const q = matchPrompt(message);
    if (!q) {notice(t('Pilih topik latihan untuk melihat jawapan contohnya.','Choose a practice topic to see its example answer.'));$('guided-topic').focus();return;}
    notice();choosePrompt(q);
    addMessage(t('Anda','You'),local(q).question,'question');
    const reply = addMessage(t('Jawapan contoh','Example answer'),local(q).answer[0],'reply');
    local(q).answer.slice(1).forEach(step => reply.append(node('p','',step)));
    $('conversation').scrollTop=$('conversation').scrollHeight;
    return;
  }
  if(!message){notice(t('Taip atau rakam soalan dahulu.','Type or dictate a question first.'));$('message').focus();return;}
  stopRecognition(true);liveReply=null;
  exchange={sentAt:performance.now(),status:'waiting'};renderExchange();
  addMessage(t('Anda','You'),message,'question');
  avatar.setSpeechEndpoint(speechEndpoint());
  const scenarioContext = scenario?`${scenarioDescription(scenario)} ${t('Matlamat: ','Goal: ')}${local(scenario).goal}`.slice(0,500):'';
  const options = {language, subject, scenario: scenarioContext};
  if (!window.ILMUAccess) {
    performSpeech(() => avatar.speak(message, options), 'live');
    return;
  }
  performSpeech(async id => {
    const controller = new AbortController();
    chatRequest = controller;
    try {
      const data = await window.ILMUAccess.chat({message, ...options}, controller.signal);
      if (id !== speechId) return;
      if (data.reply) showSpeechText(data.reply);
      await avatar.speakAudio(data.audioBase64, data.visemes);
    } finally {
      if (chatRequest === controller) chatRequest = null;
    }
  }, 'live');
};
let chatRequest = null;
window.addEventListener('ilmu-session-locked', () => {
  stopEverything();
  $('conversation').replaceChildren();
  $('message').value = '';
  exchange = null; renderExchange();
});
function stopEverything() {
  chatRequest?.abort();
  stopRecognition(true);++speechId;
  if(speechKind==='live')finishExchange('cancelled');speechKind=null;avatar.stop();if(ready)avatar.stopAnimation();setBody('idle');clearTimeout(captionTimer);$('caption').hidden=true;controlsBusy(false);if(ready)setPhase(modelLoading?'opening':'idle');
}
$('stop').onclick=()=>stopEverything();
const greetingSamples = new Map();
$('preview-sample').onclick = () => $('sample').click();
$('sample').onclick = () => {
  const path = t('demo/greeting.json', 'demo/greeting-en-GB.json');
  performSpeech(async id => {
    if (!greetingSamples.has(path)) {
      const response = await fetch(path);
      if (!response.ok) throw Error('Sample missing');
      greetingSamples.set(path, await response.json());
    }
    if (id !== speechId) return;
    const sample = greetingSamples.get(path);
    $('caption').textContent = sample.reply;
    $('caption').hidden = false;
    await avatar.speakAudio(sample.audioBase64, sample.visemes);
  }, 'sample');
};
function updateMic(message) {
  updateStop();
  $('mic').setAttribute('aria-pressed',String(micOn||micStarting));$('mic').classList.toggle('recording',micOn);
  $('mic-label').textContent=micOn||micStarting?t('Henti mikrofon','Stop microphone'):t('Mikrofon','Microphone');
  $('mic').disabled=!canRecognize||!ready||modelLoading;
  if(message!==undefined)$('mic-status').textContent=message;
  else if(!canRecognize)$('mic-status').textContent=!window.isSecureContext?t('Mikrofon memerlukan HTTPS atau localhost. Taip soalan di atas.','Microphone needs HTTPS or localhost. Type your question above.'):t('Pengecaman suara tidak tersedia dalam pelayar ini. Taip soalan di atas.','Speech recognition is unavailable in this browser. Type your question above.');
}
function stopRecognition(discard=true) {
  const current=recognition;
  if(!current)return;
  if(ready)avatar.stopAnimation();
  if(discard){recognition=null;micOn=false;micStarting=false;try{current.abort();}catch{};updateMic(t('Semak transkrip sebelum hantar.','Review the transcript before sending.'));if(phase==='listening'){setBody('idle');setPhase('idle');}}
  else {try{current.stop();}catch{}micOn=false;micStarting=false;setBody('idle');setPhase('idle');updateMic(t('Menyiapkan transkrip…','Finishing transcript…'));}
}
$('mic').onclick=()=>{
  if(recognition){stopRecognition(micStarting);return;}
  if(!canRecognize)return;
  stopEverything();notice();micStarting=true;micError=false;updateMic(t('Benarkan mikrofon apabila diminta.','Allow microphone access when prompted.'));
  const current=new Recognition();recognition=current;current.lang=language;current.continuous=true;current.interimResults=true;current.maxAlternatives=1;
  const prefix=speechEndpoint() ? $('message').value.trim() : '';
  current.onaudiostart=()=>{if(recognition!==current)return;micStarting=false;micOn=true;setBody('listening');avatar.playAnimation('nod');setPhase('listening');updateMic(t('Mendengar… tekan Henti mikrofon apabila selesai.','Listening… press Stop microphone when finished.'));};
  current.onresult=event=>{if(recognition!==current)return;const parts=[];for(let i=0;i<event.results.length;i++)parts.push(event.results[i][0].transcript);$('message').value=[prefix,parts.join(' ').trim()].filter(Boolean).join(' ');};
  current.onaudioend=()=>{if(recognition!==current)return;micOn=false;setBody('idle');if(phase==='listening')setPhase('idle');updateMic();};
  current.onerror=event=>{
    if(recognition!==current)return;micError=true;
    const messages={
      'not-allowed':['Kebenaran mikrofon ditolak. Benarkan dalam tetapan pelayar atau taip soalan.','Microphone permission was denied. Allow it in browser settings or type your question.'],
      'service-not-allowed':['Perkhidmatan pengecaman tidak dibenarkan. Taip soalan anda.','The recognition service is not allowed. Type your question.'],
      'audio-capture':['Mikrofon tidak ditemui atau sedang digunakan. Semak peranti anda.','No microphone is available, or it is in use. Check your device.'],
      'network':['Pengecaman suara gagal menyambung. Semak Internet atau taip soalan.','Speech recognition could not connect. Check Internet access or type your question.'],
      'no-speech':['Tiada suara dikesan. Cuba lagi atau taip soalan.','No speech was detected. Try again or type your question.'],
      'language-not-supported':['Bahasa ini tidak disokong oleh pengecaman pelayar. Taip soalan anda.','This language is not supported by browser recognition. Type your question.']
    };
    if(event.error!=='aborted')updateMic(t(...(messages[event.error]||['Mikrofon berhenti. Anda masih boleh menaip.','The microphone stopped. You can still type.'])));
    micOn=false;micStarting=false;setBody('idle');setPhase('idle');updateMic();
  };
  current.onend=()=>{if(recognition!==current)return;recognition=null;micOn=false;micStarting=false;setBody('idle');setPhase('idle');updateMic(micError?undefined:t('Semak transkrip sebelum meneruskan.','Review the transcript before continuing.'));};
  try{current.start();}catch(error){recognition=null;micOn=false;micStarting=false;updateMic(t('Mikrofon tidak dapat dimulakan. Taip soalan anda.','Could not start the microphone. Type your question.'));console.warn('ILMU microphone:',error.message);}
};
async function load(what,label) {
  stopEverything(false);const id=++loadId;modelLoading=true;controlsBusy(false);setPhase('opening');notice();document.querySelectorAll('[data-character]').forEach(b=>b.disabled=true);
  try{await avatar.loadAvatar(what);if(id!==loadId)return;avatar.setFraming('head');syncCharacter(label);markClip(null);await buildGestures();if(!busy&&!micOn)setPhase('idle');$('character-dialog').close();}
  catch(error){if(id!==loadId)return;syncCharacter();console.warn('ILMU model:',error.message);setPhase('error');$('character-dialog').close();notice(t('Model tidak dapat dibuka. Gunakan GLB humanoid. Model sebelumnya dikekalkan.','The model could not open. Use a humanoid GLB. The previous model is kept.'));}
  finally{if(id===loadId){modelLoading=false;controlsBusy(busy);document.querySelectorAll('[data-character]').forEach(b=>b.disabled=false);}}
}
$('demo-character').onclick=()=>{const entry=characterEntries.find(e=>e.id===catalogue.defaultAvatar)||characterEntries[0];if(entry)load(entry.id,characterName(entry));};
$('load-url').onclick=()=>{if($('url').value.trim())load($('url').value.trim(),t('Model web','Web model'));};
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;if(!file.name.toLowerCase().endsWith('.glb'))return notice(t('Pilih fail .glb.','Choose a .glb file.'));const url=URL.createObjectURL(file);$('file-name').textContent=file.name;try{await load(url,file.name);}finally{URL.revokeObjectURL(url);}};
const applyBackground=()=>{avatar.setBackgroundColor($('transparent').checked?'transparent':$('colour').value);$('frame').classList.toggle('checker',$('transparent').checked);};
$('colour').oninput=applyBackground;$('transparent').onchange=applyBackground;$('visible').onchange=()=>avatar.setVisible($('visible').checked);$('eye-contact').onchange=()=>avatar.setLookAtCamera($('eye-contact').checked);
$('endpoint').oninput=()=>{
  $('connection-result').textContent='';
  renderAsk();renderPractice();
};
$('check-connection').onclick=async()=>{
  if (!speechEndpoint()) {
    $('connection-result').textContent=$('endpoint').value.trim() ? t('Masukkan alamat HTTPS untuk pelayan pertuturan.','Enter an HTTPS speech server address.') : t('Mod latihan tersedia.','Practice mode is available.');
    return;
  }
  $('check-connection').disabled=true;$('connection-result').textContent=t('Menyemak…','Checking…');
  try{const url=new URL($('endpoint').value.trim(),location.href);url.pathname=url.pathname.replace(/\/chat\/?$/,'/health');url.search='';const r=await fetch(url,{signal:AbortSignal.timeout(7000)}),data=await r.json();
    if(r.ok&&data.status==='demo')$('connection-result').textContent=t('Mod sampel tersedia. Konfigurasikan AI pada pelayan untuk jawapan langsung.','Sample mode is ready. Configure AI on the server for live replies.');
    else if(r.ok&&data.status==='online')$('connection-result').textContent=t('Pelayan dalam talian. Hantar soalan untuk menguji penyedia AI dan suara.','Server online. Send a question to test the AI and voice providers.');else throw Error('Offline');
  }catch{$('connection-result').textContent=t('Pelayan tidak dapat dihubungi. Latihan teks dan sampel masih tersedia.','Could not reach the server. Text practice and the sample still work.');}finally{$('check-connection').disabled=false;}
};
function translate() {
  document.documentElement.lang=language==='ms-MY'?'ms':'en';document.title=t('ILMU • Teman Belajar SPM','ILMU • SPM Study Companion');
  localizeLabels(document, language);
  $('avatars').setAttribute('aria-label',t('Pilih teman belajar','Choose your companion'));
  renderAsk();renderPractice();renderScenarios();renderExchange();if(selectedQuestion)showAnswer(selectedQuestion);if(characterEntries.length)renderCharacters();setPhase(phase);updateMic();
}
$('language').onchange=()=>{
  const prompt=matchPrompt($('message').value);
  stopEverything(false);language=$('language').value;avatar.setLanguage(language);notice();
  if(prompt && !speechEndpoint())choosePrompt(prompt);
  $('mic-status').textContent='';micError=false;
  $('tone-text').value=t('Selamat pagi, mari belajar bersama.','Good morning, let us learn together.');translate();
  if(ready){buildAnimations();buildGestures();}
};
function testTone(text) {
  const words=[];let time=.15;
  for(const token of text.split(/\s+/)){const letters=token.replace(/[^a-z]/gi,'').length;if(!letters)continue;const duration=.08+letters*.065;words.push({word:token,start:time,end:time+duration});time+=duration+(/[,.;:!?]$/.test(token)?.28:.05);}
  const visemes=ILMUAvatar.buildVisemes(words,language),rate=22050,length=Math.ceil((time+.3)*rate),samples=new Float32Array(length);
  for(const event of visemes){const loud='AIUEO'.includes(event.v)?.35:event.v==='X'||event.v==='-'?0:.12,from=Math.floor(event.t*rate),to=Math.min(length,Math.floor((event.t+event.d)*rate));for(let i=from;i<to;i++)samples[i]=loud*Math.min(1,(i-from)/200,(to-i)/200)*(.6*Math.sin(2*Math.PI*180*i/rate)+.4*Math.sin(2*Math.PI*360*i/rate));}
  const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);const str=(o,s)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
  str(0,'RIFF');view.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,samples.length*2,true);for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.max(-1,Math.min(1,samples[i]))*32767,true);
  let binary='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return{base64:btoa(binary),visemes};
}
function speakTone(withVisemes){const sound=testTone($('tone-text').value);performSpeech(()=>avatar.speakAudio(sound.base64,withVisemes?sound.visemes:undefined),'test');}
$('tone').onclick=()=>speakTone(true);$('tone-plain').onclick=()=>speakTone(false);
const ticker=setInterval(()=>{if(exchange&&!exchange.endAt)renderExchange();},250);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopRecognition(true);});
window.addEventListener('pagehide',()=>{stopRecognition(true);clearInterval(ticker);avatar.destroy();},{once:true});
translate();
