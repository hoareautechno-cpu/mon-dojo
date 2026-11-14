/* Mon Dojo : outil perso d'organisation (ménage, santé, sport, mental).
   Données chiffrées (AES-GCM, clé dérivée du mot de passe) dans le stockage du navigateur.
   Aucune dépendance, aucun serveur. */
(() => {
'use strict';

// ======================================================================
// Utilitaires
// ======================================================================
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000); // b - a
const weekStart = (k) => { const d = parseKey(k); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return keyOf(d); };
const weekdayIdx = (k) => (parseKey(k).getDay() + 6) % 7; // 0 = lundi
const WD = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const WD_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const fmtDate = (k, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => parseKey(k).toLocaleDateString('fr-FR', opts);
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const round1 = (x) => (x == null ? '–' : (Math.round(x * 10) / 10).toString().replace('.', ','));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ======================================================================
// Chiffrement
// ======================================================================
const STORE_KEY = 'monDojo.v1';
const ITER = 250000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
async function encryptJSON(obj, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { app: 'mon-dojo', v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function decryptJSON(blob, password) {
  const salt = unb64(blob.salt);
  const key = await deriveKey(password, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return { data: JSON.parse(dec.decode(pt)), key, salt };
}

let S = null;         // état déchiffré
let KEY = null;       // clé AES en mémoire seulement
let SALT = null;
let saveTimer = null;

function readBlob() {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
async function saveNow() {
  if (!S || !KEY) return;
  const blob = await encryptJSON(S, KEY, SALT);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(blob)); } catch (e) { toast('Stockage plein ou bloqué : exporte une sauvegarde.'); }
}

// ======================================================================
// État par défaut
// ======================================================================
function defaultChores() {
  const c = (name, zone, freq, minutes = 10) => ({ id: uid(), name, zone, freq, minutes, last: null });
  return [
    c('Vaisselle et plan de travail', 'Cuisine', { type: 'daily' }, 10),
    c('Rangement express 10 min', 'Maison', { type: 'daily' }, 10),
    c('Lancer / étendre une machine', 'Linge', { type: 'every', n: 3 }, 10),
    c('Balai / aspirateur pièces de vie', 'Salon', { type: 'every', n: 4 }, 15),
    c('Sortir les poubelles', 'Maison', { type: 'weekly', days: [0, 3] }, 5),
    c('Salle de bain et WC', 'Salle de bain', { type: 'weekly', days: [1] }, 20),
    c('Chambres : ranger et aérer', 'Chambres', { type: 'weekly', days: [2] }, 15),
    c('Trier le frigo', 'Cuisine', { type: 'weekly', days: [3] }, 10),
    c('Serpillière', 'Maison', { type: 'weekly', days: [4] }, 20),
    c('Courses avec une liste (après avoir mangé)', 'Courses', { type: 'weekly', days: [5] }, 45),
    c('Changer les draps', 'Chambres', { type: 'every', n: 14 }, 15),
  ];
}
function defaultPlans() {
  return [
    { id: uid(), trigger: 'Écran / soirée', ifTxt: "j'ai une envie de sucré le soir devant un écran", thenTxt: 'je bois un grand verre d’eau, je me brosse les dents et j’attends 15 min' },
    { id: uid(), trigger: 'Fatigue', ifTxt: 'je suis fatigué l’après-midi', thenTxt: 'je prends la collation prévue (yaourt, œuf, fruit, poignée d’amandes)' },
    { id: uid(), trigger: 'Stress', ifTxt: 'je suis stressé ou en colère', thenTxt: 'je fais 1 minute de respiration avant de manger quoi que ce soit' },
    { id: uid(), trigger: 'Faim', ifTxt: "j'ai très faim", thenTxt: 'je mange un vrai repas avec des protéines, pas un snack sucré' },
  ];
}
function newState(name) {
  return {
    v: 1,
    createdAt: todayKey(),
    profile: { name: name || 'Patrice', sportGoal: 3 },
    days: {},
    inbox: [],
    chores: defaultChores(),
    choreLog: [],
    cravings: [],
    workouts: [],
    plannedWorkouts: {},
    plans: defaultPlans(),
    xp: 0,
    badges: {},
    reviews: [],
    seenReview: null,
  };
}
const day = (k = todayKey()) => (S.days[k] ||= { priorities: [] });

// ======================================================================
// Ménage : récurrences
// ======================================================================
function choreDoneOn(ch, k) { return S.choreLog.some((l) => l.choreId === ch.id && l.date === k); }
function lastDoneBefore(ch, k) {
  let best = null;
  for (const l of S.choreLog) if (l.choreId === ch.id && l.date < k && (!best || l.date > best)) best = l.date;
  return best;
}
// Est-ce que la tâche est à faire le jour k ? (aujourd'hui : en tenant compte des retards)
function choreDue(ch, k) {
  const f = ch.freq;
  if (f.type === 'daily') return true;
  if (f.type === 'weekly') return (f.days || []).includes(weekdayIdx(k));
  if (f.type === 'every') {
    const last = lastDoneBefore(ch, k);
    if (!last) return true;
    return diffDays(last, k) >= f.n;
  }
  return false;
}
// Projection pour la semaine : prochaines dates prévues
function choreScheduledOn(ch, k) {
  const t = todayKey();
  if (k <= t) return choreDue(ch, k) || choreDoneOn(ch, k);
  const f = ch.freq;
  if (f.type !== 'every') return choreDue(ch, k);
  // tâche "tous les n jours" : prochaine date à partir de la dernière fois
  let last = null;
  for (const l of S.choreLog) if (l.choreId === ch.id && l.date <= t && (!last || l.date > last)) last = l.date;
  let next;
  if (last === t) next = addDays(t, f.n);
  else if (last) next = addDays(last, f.n) < t ? addDays(t, f.n) : addDays(last, f.n);
  else next = addDays(t, f.n);
  // (si en retard, elle est due aujourd'hui, puis revient n jours après)
  if (k < next) return false;
  return diffDays(next, k) % f.n === 0;
}
function freqLabel(f) {
  if (f.type === 'daily') return 'Tous les jours';
  if (f.type === 'every') return `Tous les ${f.n} jours`;
  if (f.type === 'weekly') return (f.days || []).map((d) => WD[d]).join(', ') || 'Jamais';
  return '';
}

// ======================================================================
// Activité, XP, niveaux, badges
// ======================================================================
const RANKS = [
  [0, 'Apprenti'], [150, 'Apprenti confirmé'], [400, 'Combattant'], [800, 'Guerrier'],
  [1300, 'Samouraï'], [2000, 'Ninja'], [3000, 'Ninja d’élite'], [4300, 'Sensei'],
  [6000, 'Grand Sensei'], [8500, 'Légende'],
];
function levelInfo(xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1][0]) i++;
  const cur = RANKS[i][0];
  const next = RANKS[i + 1] ? RANKS[i + 1][0] : cur + 3000;
  return { level: i + 1, rank: RANKS[i][1], cur, next, pct: clamp(((xp - cur) / (next - cur)) * 100, 0, 100) };
}

function isActive(k) {
  const d = S.days[k];
  if (d && (d.mood || d.sleep || d.weight || d.gratitude || d.breath || (d.priorities || []).some((p) => p.done))) return true;
  if (S.choreLog.some((l) => l.date === k)) return true;
  if (S.cravings.some((c) => c.date === k)) return true;
  if (S.workouts.some((w) => w.date === k)) return true;
  return false;
}
function weekKeys(ws) { return [...Array(7)].map((_, i) => addDays(ws, i)); }

const BADGES = [
  { id: 'premier-pas', ic: '👣', nm: 'Premier pas', ds: 'Premier check-in', t: () => Object.values(S.days).some((d) => d.mood) },
  { id: 'focus', ic: '🎯', nm: 'Focus', ds: '10 priorités accomplies', t: () => countPrioDone() >= 10 },
  { id: 'focus2', ic: '🏹', nm: 'Tireur d’élite', ds: '50 priorités accomplies', t: () => countPrioDone() >= 50 },
  { id: 'seance1', ic: '🥋', nm: 'Première séance', ds: '1 séance de sport', t: () => S.workouts.length >= 1 },
  { id: 'seance10', ic: '💪', nm: 'Guerrier', ds: '10 séances', t: () => S.workouts.length >= 10 },
  { id: 'seance50', ic: '🔥', nm: 'Machine', ds: '50 séances', t: () => S.workouts.length >= 50 },
  { id: 'semaine-sport', ic: '🏆', nm: 'Objectif sport', ds: 'Objectif de séances atteint sur une semaine', t: () => anyWeek((ks) => S.workouts.filter((w) => ks.includes(w.date)).length >= S.profile.sportGoal) },
  { id: 'surf1', ic: '🌊', nm: 'Surfeur', ds: '1 envie surfée', t: () => surfed() >= 1 },
  { id: 'surf10', ic: '🏄', nm: 'Maître des vagues', ds: '10 envies surfées', t: () => surfed() >= 10 },
  { id: 'surf30', ic: '🐉', nm: 'Dompteur de dragon', ds: '30 envies surfées', t: () => surfed() >= 30 },
  { id: 'lucide', ic: '🔍', nm: 'Lucidité', ds: '10 envies notées (surfées ou non)', t: () => S.cravings.filter((c) => c.outcome !== 'pending').length >= 10 },
  { id: 'relever', ic: '🌅', nm: 'Je me relève', ds: 'Une envie surfée après un craquage', t: () => relevé() },
  { id: 'menage30', ic: '🧹', nm: 'Maison nickel', ds: '30 tâches de ménage', t: () => S.choreLog.length >= 30 },
  { id: 'menage100', ic: '🥷', nm: 'Ninja du ménage', ds: '100 tâches de ménage', t: () => S.choreLog.length >= 100 },
  { id: 'zen10', ic: '🧘', nm: 'Esprit zen', ds: '10 respirations guidées', t: () => Object.values(S.days).reduce((a, d) => a + (d.breath || 0), 0) >= 10 },
  { id: 'merci7', ic: '🙏', nm: 'Gratitude', ds: '7 gratitudes notées', t: () => Object.values(S.days).filter((d) => d.gratitude).length >= 7 },
  { id: 'balance5', ic: '⚖️', nm: 'Suivi poids', ds: '5 pesées', t: () => Object.values(S.days).filter((d) => d.weight).length >= 5 },
  { id: 'regulier', ic: '📅', nm: 'Régulier', ds: '5 jours actifs dans une semaine', t: () => anyWeek((ks) => ks.filter(isActive).length >= 5) },
  { id: 'sommeil', ic: '😴', nm: 'Gardien du sommeil', ds: '7 nuits de 7 h ou plus', t: () => Object.values(S.days).filter((d) => d.sleep >= 7).length >= 7 },
  { id: 'bilan', ic: '📜', nm: 'Stratège', ds: 'Lire un bilan hebdo', t: () => !!S.seenReview },
  { id: 'niveau5', ic: '⭐', nm: 'Samouraï', ds: 'Atteindre le niveau 5', t: () => levelInfo(S.xp).level >= 5 },
];
function countPrioDone() { return Object.values(S.days).reduce((a, d) => a + (d.priorities || []).filter((p) => p.done).length, 0); }
function surfed() { return S.cravings.filter((c) => c.outcome === 'surfed').length; }
function relevé() {
  const done = S.cravings.filter((c) => c.outcome !== 'pending').sort((a, b) => a.ts - b.ts);
  let gave = false;
  for (const c of done) { if (c.outcome === 'gave') gave = true; else if (gave && c.outcome === 'surfed') return true; }
  return false;
}
function anyWeek(fn) {
  const t = todayKey();
  let ws = weekStart(S.createdAt);
  while (ws <= t) { if (fn(weekKeys(ws))) return true; ws = addDays(ws, 7); }
  return false;
}

function award(xp, sfx = 'BAM !', msg = '') {
  const before = levelInfo(S.xp).level;
  S.xp = Math.max(0, S.xp + xp);
  const after = levelInfo(S.xp);
  if (xp > 0) toast(`${msg ? esc(msg) + ' · ' : ''}+${xp} XP`, sfx);
  checkBadges();
  save();
  if (after.level > before) levelUp(after);
}
function checkBadges() {
  for (const b of BADGES) {
    if (!S.badges[b.id] && b.t()) {
      S.badges[b.id] = todayKey();
      setTimeout(() => toast(`Badge débloqué : ${b.ic} ${b.nm}`, 'NOUVEAU BADGE !'), 1300);
    }
  }
}

// ======================================================================
// Bilan hebdo automatique
// ======================================================================
const TRIGGERS = ['Faim', 'Fatigue', 'Stress', 'Colère', 'Ennui', 'Solitude', 'Écran / soirée', 'Fête / social', 'Habitude', 'Autre'];

function weekStats(ws) {
  const ks = weekKeys(ws);
  const inW = (k) => ks.includes(k);
  const days = ks.map((k) => S.days[k]).filter(Boolean);
  const moods = days.map((d) => d.mood).filter(Boolean);
  const sleeps = days.map((d) => d.sleep).filter(Boolean);
  const weights = ks.map((k) => S.days[k]?.weight).filter(Boolean);
  const cr = S.cravings.filter((c) => inW(c.date) && c.outcome !== 'pending');
  const trig = {};
  cr.forEach((c) => { if (c.trigger) trig[c.trigger] = (trig[c.trigger] || 0) + 1; });
  const topTrigger = Object.entries(trig).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    ws,
    active: ks.filter(isActive).length,
    workouts: S.workouts.filter((w) => inW(w.date)).length,
    workoutMin: S.workouts.filter((w) => inW(w.date)).reduce((a, w) => a + (w.minutes || 0), 0),
    chores: S.choreLog.filter((l) => inW(l.date)).length,
    prios: days.reduce((a, d) => a + (d.priorities || []).filter((p) => p.done).length, 0),
    cravings: cr.length,
    surfed: cr.filter((c) => c.outcome === 'surfed').length,
    topTrigger,
    mood: avg(moods),
    sleep: avg(sleeps),
    weightStart: weights[0] ?? null,
    weightEnd: weights[weights.length - 1] ?? null,
    breath: days.reduce((a, d) => a + (d.breath || 0), 0),
  };
}

function reviewText(st) {
  const wins = [];
  const tips = [];
  if (st.workouts >= S.profile.sportGoal) wins.push(`Objectif sport atteint : ${st.workouts} séance${st.workouts > 1 ? 's' : ''} (${st.workoutMin} min).`);
  else if (st.workouts > 0) wins.push(`${st.workouts} séance${st.workouts > 1 ? 's' : ''} de sport, c’est du concret.`);
  if (st.surfed > 0) wins.push(`${st.surfed} envie${st.surfed > 1 ? 's' : ''} surfée${st.surfed > 1 ? 's' : ''} sur ${st.cravings}. Chaque vague passée renforce le muscle.`);
  if (st.chores >= 10) wins.push(`${st.chores} tâches de ménage faites. La maison te dit merci.`);
  else if (st.chores > 0) wins.push(`${st.chores} tâches de ménage cochées.`);
  if (st.prios > 0) wins.push(`${st.prios} priorité${st.prios > 1 ? 's' : ''} accomplie${st.prios > 1 ? 's' : ''}.`);
  if (st.active >= 5) wins.push(`${st.active} jours actifs sur 7 : belle régularité.`);
  if (!wins.length) wins.push('Tu es là, tu ouvres ton bilan : c’est déjà repartir. Une semaine calme n’efface rien.');

  if (st.sleep != null && st.sleep < 7) tips.push(`Sommeil moyen ${round1(st.sleep)} h : vise une heure de coucher fixe cette semaine. Le manque de sommeil augmente les envies de sucre.`);
  if (st.topTrigger) tips.push(`Déclencheur n°1 : « ${st.topTrigger} ». Prépare un plan « si… alors… » précis pour ce moment-là.`);
  if (st.workouts < S.profile.sportGoal) tips.push(`Sport : place tes ${S.profile.sportGoal} séances dans « Ma semaine » dès maintenant, avec un jour et une heure.`);
  if (st.mood != null && st.mood < 3) tips.push('Humeur basse cette semaine : garde 1 minute de respiration par jour et parles-en à quelqu’un de confiance. Si ça dure, ton médecin peut t’aider.');
  if (st.chores < 5) tips.push('Ménage : juste les 10 minutes de rangement le soir, rien de plus. Le reste suivra.');
  if (!tips.length) tips.push('Garde le même cap et ajoute une seule petite chose : par exemple 1 gratitude par jour.');

  let weight = null;
  if (st.weightStart != null && st.weightEnd != null && st.weightStart !== st.weightEnd) {
    const d = st.weightEnd - st.weightStart;
    weight = `Poids : ${round1(st.weightStart)} → ${round1(st.weightEnd)} kg (${d > 0 ? '+' : ''}${round1(d)}). Regarde la tendance sur un mois, pas au jour le jour.`;
  }
  return { wins, tips: tips.slice(0, 3), weight };
}

function generateReviews() {
  const t = todayKey();
  const thisWeek = weekStart(t);
  let ws = weekStart(S.createdAt);
  let changed = false;
  while (ws < thisWeek) {
    if (!S.reviews.some((r) => r.ws === ws)) {
      const st = weekStats(ws);
      S.reviews.push({ ...st, ...reviewText(st), createdAt: t });
      changed = true;
    }
    ws = addDays(ws, 7);
  }
  if (changed) { S.reviews.sort((a, b) => (a.ws < b.ws ? 1 : -1)); save(); }
}

// ======================================================================
// Messages motivants
// ======================================================================
const QUOTES = [
  'La discipline, c’est choisir ce que tu veux le plus plutôt que ce que tu veux maintenant.',
  'Tomber fait partie de l’entraînement. Se relever, c’est ça le niveau.',
  'Un petit pas chaque jour bat un grand saut une fois par mois.',
  'Tu n’as pas besoin d’être motivé. Tu as besoin de commencer 2 minutes.',
  'Un écart n’est pas une rechute. Le prochain repas est un nouveau départ.',
  'Aujourd’hui, 3 priorités. Pas 30. Les héros aussi choisissent leurs combats.',
  'Le corps entend tout ce que tu fais pour lui. Continue.',
  'Une envie, c’est une vague : elle monte, elle culmine, elle redescend.',
  'Tu t’entraînes pour toi, et pour ceux qui comptent sur toi.',
  'La régularité est un super-pouvoir qui ne fait pas de bruit.',
  'Bien dormir, c’est s’entraîner en dormant.',
  'Ce que tu répètes, tu le deviens. Choisis bien.',
  'Pas parfait. Présent.',
  'Chaque tâche cochée, c’est de la charge mentale en moins.',
];
const quoteOfDay = () => QUOTES[(parseKey(todayKey()) / 86400000 | 0) % QUOTES.length];
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Encore debout';
  if (h < 12) return 'Ohayō';
  if (h < 18) return 'Yo';
  return 'Konbanwa';
}

// ======================================================================
// UI : toasts, modales, level up
// ======================================================================
function toast(html, sfx = '') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = (sfx ? `<span class="sfx">${esc(sfx)}</span>` : '') + html;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
function levelUp(info) {
  const ov = $('#overlay');
  ov.innerHTML = `<div class="levelup" data-action="close-levelup"><div>
    <div class="big">LEVEL UP !</div>
    <div class="rk">Niveau ${info.level} · ${esc(info.rank)}</div>
    <p style="font-weight:800;margin-top:18px">Touchez pour continuer</p></div></div>`;
  if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
}
let modalTick = null;
function openModal(html) {
  closeModal();
  $('#overlay').innerHTML = `<div class="modal-bg" data-action="modal-bg"><div class="modal" role="dialog">${html}</div></div>`;
}
function closeModal() {
  clearInterval(modalTick); modalTick = null;
  $('#overlay').innerHTML = '';
}

// ======================================================================
// Écran de verrouillage
// ======================================================================
function renderLock() {
  $('#tabbar').innerHTML = '';
  const blob = readBlob();
  const create = !blob;
  $('#app').innerHTML = `
  <div class="lock">
    <div class="logo">MON<br>DOJO</div>
    <div class="logo-sub">Ménage · Santé · Sport · Mental</div>
    <form class="card" id="lockForm" autocomplete="off">
      <div class="card-head"><h2 class="c-pink">${create ? 'Créer ton dojo' : 'Bon retour !'}</h2></div>
      ${create ? `
        <label class="lbl" for="nm">Ton prénom</label>
        <input class="input" id="nm" value="Patrice" maxlength="30">
        <label class="lbl" for="pw">Choisis un mot de passe</label>
        <input class="input" id="pw" type="password" autocomplete="new-password" minlength="4" required>
        <label class="lbl" for="pw2">Encore une fois</label>
        <input class="input" id="pw2" type="password" autocomplete="new-password" required>
        <p class="small-note">Tes données restent sur ce téléphone, chiffrées avec ce mot de passe. Si tu l’oublies, personne ne pourra les récupérer : note-le dans un endroit sûr.</p>
      ` : `
        <label class="lbl" for="pw">Mot de passe</label>
        <input class="input" id="pw" type="password" autocomplete="current-password" required autofocus>
      `}
      <div class="err" id="err"></div>
      <button class="btn btn-primary btn-big btn-block mt" type="submit">${create ? 'C’est parti !' : 'Entrer'}</button>
      ${create ? `<button class="btn btn-ghost btn-block mt" type="button" data-action="import">J’ai une sauvegarde à importer</button>` : ''}
    </form>
  </div>`;
  $('#lockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#err');
    const pw = $('#pw').value;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '…';
    try {
      if (create) {
        if (pw.length < 4) throw new Error('4 caractères minimum.');
        if (pw !== $('#pw2').value) throw new Error('Les deux mots de passe sont différents.');
        SALT = crypto.getRandomValues(new Uint8Array(16));
        KEY = await deriveKey(pw, SALT);
        S = newState($('#nm').value.trim());
        await saveNow();
      } else {
        const r = await decryptJSON(blob, pw).catch(() => { throw new Error('Mot de passe incorrect.'); });
        S = migrate(r.data); KEY = r.key; SALT = r.salt;
      }
      start();
    } catch (ex) {
      err.textContent = ex.message || 'Erreur';
      btn.disabled = false; btn.textContent = create ? 'C’est parti !' : 'Entrer';
    }
  });
}
function migrate(s) {
  const base = newState(s?.profile?.name);
  for (const k of Object.keys(base)) if (s[k] === undefined) s[k] = base[k];
  return s;
}

// ======================================================================
// Navigation
// ======================================================================
const TABS = [
  ['today', '⚡', 'Journée'],
  ['week', '🗓️', 'Semaine'],
  ['stats', '📈', 'Stats'],
  ['more', '🏯', 'Dojo'],
];
let route = 'today';
let statsRange = 30;
function setRoute(r) { route = r; if (location.hash !== '#' + r) history.replaceState(null, '', '#' + r); render(); window.scrollTo(0, 0); }
function renderTabs() {
  $('#tabbar').innerHTML = `<div class="tabbar"><nav>${TABS.map(([id, ic, lb]) =>
    `<a href="#${id}" class="${route === id ? 'on' : ''}" data-route="${id}"><span class="ti">${ic}</span>${lb}</a>`).join('')}</nav></div>`;
}
function render() {
  if (!S) return renderLock();
  renderTabs();
  const v = { today: viewToday, week: viewWeek, stats: viewStats, more: viewMore }[route] || viewToday;
  $('#app').innerHTML = v();
  afterRender();
}
function afterRender() {
  // Courbes : rien à faire, SVG inline. Gestion du minuteur d'envie dans la carte.
  const pend = pendingCraving();
  if (pend && route === 'today') {
    const el = $('#cravingLeft');
    if (el) {
      const tick = () => {
        const left = Math.max(0, pend.end - Date.now());
        el.textContent = fmtMs(left);
      };
      tick();
      clearInterval(window.__ct); window.__ct = setInterval(tick, 1000);
    }
  }
}
const fmtMs = (ms) => { const s = Math.ceil(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

// ======================================================================
// Vue : Ma journée
// ======================================================================
function heroHTML() {
  const li = levelInfo(S.xp);
  const t = todayKey();
  return `
  <section class="hero">
    <div class="hello">${greeting()} ${esc(S.profile.name)} !</div>
    <div class="date">${fmtDate(t)}</div>
    <div class="hero-row">
      <div class="level-badge"><div><small>Niv.</small><b>${li.level}</b></div></div>
      <div class="xp-wrap">
        <div class="rank">${esc(li.rank)}</div>
        <div class="xpbar"><i style="width:${li.pct}%"></i></div>
        <div class="xp-txt">${S.xp} XP · encore ${li.next - S.xp} XP pour le niveau ${li.level + 1}</div>
      </div>
    </div>
    <div class="bubble">${esc(quoteOfDay())}</div>
  </section>`;
}
function pendingCraving() { return S.cravings.find((c) => c.outcome === 'pending'); }

function viewToday() {
  const t = todayKey();
  const d = day(t);
  const prios = d.priorities || [];
  const due = S.chores.filter((c) => choreDue(c, t) || choreDoneOn(c, t));
  const doneCount = due.filter((c) => choreDoneOn(c, t)).length;
  const ws = weekStart(t);
  const wk = weekKeys(ws);
  const wCount = S.workouts.filter((w) => wk.includes(w.date)).length;
  const todayW = S.workouts.filter((w) => w.date === t);
  const planned = S.plannedWorkouts[t];
  const crToday = S.cravings.filter((c) => c.date === t && c.outcome !== 'pending');
  const pend = pendingCraving();
  const moods = ['😫', '😕', '😐', '🙂', '😄'];
  const unseen = S.reviews[0] && S.seenReview !== S.reviews[0].ws;

  return `
  ${heroHTML()}

  ${unseen ? `<button class="btn btn-yellow btn-block" style="margin-bottom:16px" data-action="open-review" data-ws="${S.reviews[0].ws}">📜 Ton bilan de la semaine est prêt !</button>` : ''}

  <section class="card">
    <div class="card-head"><h2 class="c-pink">Mes 3 priorités</h2><span class="meta">${prios.filter((p) => p.done).length}/${prios.length || 3}</span></div>
    <ul class="list">
      ${prios.map((p, i) => `
        <li class="item ${p.done ? 'done' : ''}">
          <button class="check ${p.done ? 'on' : ''}" data-action="prio-toggle" data-i="${i}" aria-label="Fait">${p.done ? '✓' : ''}</button>
          <span class="txt">${esc(p.t)}</span>
          <button class="icon-btn" data-action="prio-del" data-i="${i}" aria-label="Supprimer">✕</button>
        </li>`).join('')}
    </ul>
    ${prios.length < 3 ? `
      <form class="row mt" data-form="prio-add">
        <input class="prio-input" name="t" placeholder="Priorité n°${prios.length + 1}…" maxlength="120" autocomplete="off">
        <button class="btn btn-sm btn-yellow" type="submit">Ajouter</button>
      </form>` : `<p class="small-note">3 priorités, c’est le maximum : le reste va dans « Vider ma tête ».</p>`}
    <hr class="dash">
    <form class="row" data-form="inbox-add">
      <input class="prio-input" name="t" placeholder="💭 Vider ma tête (une idée, un truc à pas oublier)" maxlength="200" autocomplete="off">
      <button class="btn btn-sm" type="submit">+</button>
    </form>
    ${S.inbox.length ? `<ul class="list mt">${S.inbox.map((x) => `
      <li class="item inbox-item">
        <span class="txt">${esc(x.t)}</span>
        ${prios.length < 3 ? `<button class="btn btn-sm" data-action="inbox-promote" data-id="${x.id}" title="En faire une priorité">⬆️</button>` : ''}
        <button class="icon-btn" data-action="inbox-del" data-id="${x.id}" aria-label="Supprimer">✕</button>
      </li>`).join('')}</ul>` : ''}
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-orange">Envie de sucre ?</h2><span class="meta">${crToday.filter((c) => c.outcome === 'surfed').length} surfée(s) aujourd’hui</span></div>
    ${pend ? `
      <button class="craving-btn" data-action="craving-open">VAGUE EN COURS · <span id="cravingLeft">--:--</span></button>
      <p class="small-note center">Touchez pour reprendre le minuteur.</p>
    ` : `
      <button class="craving-btn" data-action="craving-start">J’AI UNE ENVIE !</button>
      <p class="small-note center">15 minutes pour laisser passer la vague. Pas de jugement, juste un test.</p>
    `}
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-cyan">Check-in</h2><span class="meta">${d.mood ? '✓ fait' : '30 secondes'}</span></div>
    <label class="lbl">Mon humeur</label>
    <div class="moods">${moods.map((m, i) => `<button class="mood ${d.mood === i + 1 ? 'on' : ''}" data-action="mood" data-v="${i + 1}" aria-label="Humeur ${i + 1}">${m}</button>`).join('')}</div>
    <label class="lbl">Sommeil cette nuit</label>
    <div class="chips">${[5, 6, 7, 8, 9].map((h) => `<button class="chip ${d.sleep === h ? 'on' : ''}" data-action="sleep" data-v="${h}">${h} h${h === 9 ? '+' : ''}</button>`).join('')}
      <button class="chip ${d.sleep && ![5, 6, 7, 8, 9].includes(d.sleep) ? 'on' : ''}" data-action="sleep-other">${d.sleep && ![5, 6, 7, 8, 9].includes(d.sleep) ? round1(d.sleep) + ' h' : 'Autre'}</button>
    </div>
    <label class="lbl" for="wgt">Poids (facultatif)</label>
    <form class="row" data-form="weight">
      <input class="input grow" id="wgt" name="w" type="number" inputmode="decimal" step="0.1" min="30" max="300" placeholder="kg" value="${d.weight ?? ''}">
      <button class="btn btn-cyan" type="submit">OK</button>
    </form>
    <label class="lbl" for="grat">Une chose positive aujourd’hui</label>
    <form class="row" data-form="gratitude">
      <input class="input grow" id="grat" name="g" maxlength="160" placeholder="Ex. le rire de ma fille" value="${esc(d.gratitude || '')}">
      <button class="btn btn-cyan" type="submit">OK</button>
    </form>
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-yellow">Ménage du jour</h2><span class="meta">${doneCount}/${due.length}</span></div>
    <div class="prog"><i style="width:${due.length ? (doneCount / due.length) * 100 : 0}%"></i></div>
    <ul class="list mt">
      ${due.map((c) => { const done = choreDoneOn(c, t); return `
        <li class="item ${done ? 'done' : ''}">
          <button class="check ${done ? 'on' : ''}" data-action="chore-toggle" data-id="${c.id}" aria-label="Fait">${done ? '✓' : ''}</button>
          <div class="grow"><div class="txt">${esc(c.name)}</div><div class="sub">${esc(c.zone)} · ${c.minutes} min</div></div>
        </li>`; }).join('') || '<li class="muted">Rien de prévu. Repos !</li>'}
    </ul>
    ${due.length && doneCount === due.length ? '<p class="center" style="font-weight:900">✨ Maison nickel pour aujourd’hui !</p>' : ''}
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-green">Sport</h2><span class="meta">${wCount}/${S.profile.sportGoal} cette semaine</span></div>
    <div class="prog"><i style="width:${Math.min(100, (wCount / S.profile.sportGoal) * 100)}%"></i></div>
    ${planned && !todayW.length ? `<p style="font-weight:800">Prévu aujourd’hui : ${esc(planned)}</p>` : ''}
    ${todayW.map((w) => `<div class="item"><span class="txt">✅ ${esc(w.type)} · ${w.minutes} min · intensité ${w.intensity}/5</span><button class="icon-btn" data-action="workout-del" data-id="${w.id}">✕</button></div>`).join('')}
    <button class="btn btn-green btn-block mt" data-action="workout-open">💥 J’ai fait une séance</button>
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-violet">Respire</h2><span class="meta">${d.breath ? d.breath + ' fois aujourd’hui' : 'cohérence cardiaque'}</span></div>
    <p class="muted" style="margin-top:0">5 secondes d’inspiration, 5 secondes d’expiration. Idéal avant un repas, en cas de stress ou d’envie.</p>
    <div class="row">
      <button class="btn btn-violet grow" data-action="breath" data-min="1">1 minute</button>
      <button class="btn btn-violet grow" data-action="breath" data-min="3">3 minutes</button>
    </div>
  </section>`;
}

// ======================================================================
// Vue : Ma semaine
// ======================================================================
function viewWeek() {
  const t = todayKey();
  const ws = weekStart(t);
  const st = weekStats(ws);
  const days = [...Array(7)].map((_, i) => addDays(t, i));
  return `
  <h1 class="page-title">Ma semaine</h1>
  <section class="card">
    <div class="card-head"><h2 class="c-yellow">Cette semaine</h2><span class="meta">du ${fmtDate(ws, { day: 'numeric', month: 'short' })} au ${fmtDate(addDays(ws, 6), { day: 'numeric', month: 'short' })}</span></div>
    <div class="kpis">
      <div class="kpi"><b>${st.active}/7</b><span>jours actifs</span></div>
      <div class="kpi"><b>${st.workouts}/${S.profile.sportGoal}</b><span>séances de sport</span></div>
      <div class="kpi"><b>${st.chores}</b><span>tâches de ménage</span></div>
      <div class="kpi"><b>${st.surfed}/${st.cravings}</b><span>envies surfées</span></div>
    </div>
  </section>
  ${days.map((k) => {
    const dd = S.days[k] || { priorities: [] };
    const chores = S.chores.filter((c) => choreScheduledOn(c, k));
    const w = S.workouts.filter((x) => x.date === k);
    const planned = S.plannedWorkouts[k];
    const isT = k === t;
    return `
    <section class="card day-card ${isT ? 'today' : ''}">
      <div class="card-head"><h2 class="${isT ? 'c-pink' : 'c-violet'}">${isT ? 'Aujourd’hui' : fmtDate(k, { weekday: 'long' })}</h2><span class="meta">${fmtDate(k, { day: 'numeric', month: 'long' })}</span></div>
      <div>
        ${(dd.priorities || []).map((p) => `<span class="tag prio">${p.done ? '✓ ' : '🎯 '}${esc(p.t)}</span>`).join('')}
        ${w.map((x) => `<span class="tag sport">✓ ${esc(x.type)}</span>`).join('')}
        ${planned && !w.length ? `<span class="tag sport">🥋 ${esc(planned)}</span>` : ''}
        ${chores.map((c) => `<span class="tag chore">${choreDoneOn(c, k) ? '✓ ' : ''}${esc(c.name)}</span>`).join('')}
      </div>
      <div class="row wrap mt">
        ${(dd.priorities || []).length < 3 ? `<button class="btn btn-sm" data-action="plan-prio" data-k="${k}">+ priorité</button>` : ''}
        ${!w.length ? `<button class="btn btn-sm" data-action="plan-sport" data-k="${k}">${planned ? '✎ séance' : '+ séance'}</button>` : ''}
      </div>
    </section>`;
  }).join('')}`;
}

// ======================================================================
// Vue : Stats / tableau de bord
// ======================================================================
function lineChart(points, { color = '#ff3d7f', min, max, unit = '', height = 150 } = {}) {
  // points: [{k, v}] dans l'ordre
  const W = 340, H = height, P = { l: 30, r: 8, t: 10, b: 22 };
  if (points.length < 2) return `<p class="muted">Pas encore assez de données (au moins 2 saisies).</p>`;
  const vs = points.map((p) => p.v);
  let lo = min ?? Math.floor(Math.min(...vs) - 1), hi = max ?? Math.ceil(Math.max(...vs) + 1);
  if (hi === lo) hi = lo + 1;
  const k0 = points[0].k, span = Math.max(1, diffDays(k0, points[points.length - 1].k));
  const x = (k) => P.l + (diffDays(k0, k) / span) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.k).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const ticks = [lo, (lo + hi) / 2, hi];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e3d8c6" stroke-dasharray="3 3"/><text x="${P.l - 4}" y="${y(v) + 3}" text-anchor="end">${round1(v)}${unit}</text>`).join('')}
    <path d="${path}" fill="none" stroke="#1a1033" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((p) => `<circle cx="${x(p.k)}" cy="${y(p.v)}" r="3.5" fill="#fff" stroke="#1a1033" stroke-width="2"/>`).join('')}
    <text x="${P.l}" y="${H - 6}">${fmtDate(k0, { day: 'numeric', month: 'short' })}</text>
    <text x="${W - P.r}" y="${H - 6}" text-anchor="end">${fmtDate(points[points.length - 1].k, { day: 'numeric', month: 'short' })}</text>
  </svg>`;
}
function barChart(bars, { colors = ['#2ee59d', '#ff9f1c'], height = 140, goal = null } = {}) {
  // bars: [{label, values:[a,b]}]
  const W = 340, H = height, P = { l: 22, r: 6, t: 10, b: 22 };
  const tot = bars.map((b) => b.values.reduce((a, c) => a + c, 0));
  const hi = Math.max(1, goal || 0, ...tot);
  const bw = (W - P.l - P.r) / bars.length;
  const y = (v) => P.t + (1 - v / hi) * (H - P.t - P.b);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    <line x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}" stroke="#1a1033" stroke-width="2"/>
    <text x="${P.l - 4}" y="${y(hi) + 3}" text-anchor="end">${hi}</text>
    ${goal ? `<line x1="${P.l}" x2="${W - P.r}" y1="${y(goal)}" y2="${y(goal)}" stroke="#ff3d7f" stroke-width="2" stroke-dasharray="5 4"/>` : ''}
    ${bars.map((b, i) => {
      let acc = 0;
      const x0 = P.l + i * bw + bw * 0.18, w = bw * 0.64;
      const rects = b.values.map((v, j) => {
        if (!v) return '';
        const r = `<rect x="${x0}" y="${y(acc + v)}" width="${w}" height="${y(acc) - y(acc + v)}" fill="${colors[j]}" stroke="#1a1033" stroke-width="2"/>`;
        acc += v; return r;
      }).join('');
      return rects + `<text x="${x0 + w / 2}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
    }).join('')}
  </svg>`;
}
function viewStats() {
  const t = todayKey();
  const from = addDays(t, -statsRange + 1);
  const keys = Object.keys(S.days).filter((k) => k >= from && k <= t).sort();
  const series = (f) => keys.map((k) => ({ k, v: S.days[k][f] })).filter((p) => p.v != null && p.v !== '');
  const weeks = [];
  const nW = statsRange <= 30 ? 6 : 12;
  let ws = weekStart(t);
  for (let i = 0; i < nW; i++) { weeks.unshift(ws); ws = addDays(ws, -7); }
  const wst = weeks.map(weekStats);
  const lab = (w) => fmtDate(w, { day: 'numeric', month: 'numeric' }).replace(/\/\d+$/, (m) => m);
  const allCr = S.cravings.filter((c) => c.date >= from && c.outcome !== 'pending');
  const trig = {};
  allCr.forEach((c) => { trig[c.trigger || 'Autre'] = (trig[c.trigger || 'Autre'] || 0) + 1; });
  const trigSorted = Object.entries(trig).sort((a, b) => b[1] - a[1]);
  const w = series('weight');
  const li = levelInfo(S.xp);
  const nb = Object.keys(S.badges).length;

  return `
  <h1 class="page-title">Tableau de bord</h1>
  <div class="seg" style="margin-bottom:16px">
    ${[30, 90].map((r) => `<button class="${statsRange === r ? 'on' : ''}" data-action="range" data-v="${r}">${r} jours</button>`).join('')}
  </div>
  <section class="card">
    <div class="card-head"><h2 class="c-yellow">En bref</h2></div>
    <div class="kpis">
      <div class="kpi"><b>Niv. ${li.level}</b><span>${esc(li.rank)} · ${S.xp} XP</span></div>
      <div class="kpi"><b>${nb}/${BADGES.length}</b><span>badges</span></div>
      <div class="kpi"><b>${w.length ? round1(w[w.length - 1].v) + ' kg' : '–'}</b><span>dernier poids ${w.length > 1 ? `(${w[w.length - 1].v - w[0].v > 0 ? '+' : ''}${round1(w[w.length - 1].v - w[0].v)})` : ''}</span></div>
      <div class="kpi"><b>${allCr.length ? Math.round((allCr.filter((c) => c.outcome === 'surfed').length / allCr.length) * 100) + ' %' : '–'}</b><span>envies surfées</span></div>
    </div>
  </section>
  <section class="card"><div class="card-head"><h2 class="c-pink">Poids</h2></div>${lineChart(w, { color: '#ff3d7f', unit: '' })}
    <p class="small-note">Le poids varie de 1 à 2 kg d’un jour à l’autre (eau, sel, repas). Regarde la tendance.</p></section>
  <section class="card"><div class="card-head"><h2 class="c-cyan">Humeur</h2></div>${lineChart(series('mood'), { color: '#00c2ff', min: 1, max: 5 })}</section>
  <section class="card"><div class="card-head"><h2 class="c-violet">Sommeil</h2></div>${lineChart(series('sleep'), { color: '#7b2ff7', min: 4, max: 10, unit: 'h' })}</section>
  <section class="card"><div class="card-head"><h2 class="c-orange">Envies par semaine</h2></div>
    ${barChart(wst.map((s) => ({ label: lab(s.ws), values: [s.surfed, s.cravings - s.surfed] })), { colors: ['#2ee59d', '#ff9f1c'] })}
    <div class="legend"><span><i style="background:#2ee59d"></i>surfées</span><span><i style="background:#ff9f1c"></i>craquages</span></div>
    ${trigSorted.length ? `<label class="lbl">Déclencheurs les plus fréquents</label>
      ${trigSorted.slice(0, 5).map(([k, v]) => `<div class="row" style="margin:4px 0"><span style="width:120px;font-weight:800;font-size:14px">${esc(k)}</span><div class="prog grow"><i style="width:${(v / trigSorted[0][1]) * 100}%;background:var(--orange)"></i></div><b style="width:24px;text-align:right">${v}</b></div>`).join('')}` : ''}
  </section>
  <section class="card"><div class="card-head"><h2 class="c-green">Séances par semaine</h2></div>
    ${barChart(wst.map((s) => ({ label: lab(s.ws), values: [s.workouts] })), { colors: ['#00c2ff'], goal: S.profile.sportGoal })}
    <div class="legend"><span><i style="background:#00c2ff"></i>séances</span><span><i style="background:#ff3d7f"></i>objectif (${S.profile.sportGoal})</span></div>
  </section>
  <section class="card"><div class="card-head"><h2 class="c-yellow">Ménage par semaine</h2></div>
    ${barChart(wst.map((s) => ({ label: lab(s.ws), values: [s.chores] })), { colors: ['#ffe14d'] })}
  </section>`;
}

// ======================================================================
// Vue : Dojo (bilans, badges, ménage, plans, réglages)
// ======================================================================
function reviewHTML(r) {
  return `<div class="review">
    <h3>Semaine du ${fmtDate(r.ws, { day: 'numeric', month: 'long' })}</h3>
    <div class="kpis">
      <div class="kpi"><b>${r.active}/7</b><span>jours actifs</span></div>
      <div class="kpi"><b>${r.workouts}</b><span>séances (${r.workoutMin} min)</span></div>
      <div class="kpi"><b>${r.surfed}/${r.cravings}</b><span>envies surfées</span></div>
      <div class="kpi"><b>${r.chores}</b><span>tâches de ménage</span></div>
      <div class="kpi"><b>${round1(r.mood)}</b><span>humeur moyenne /5</span></div>
      <div class="kpi"><b>${round1(r.sleep)} h</b><span>sommeil moyen</span></div>
    </div>
    <p style="font-weight:900;margin-top:12px">💪 Ce qui a marché</p>
    <ul>${r.wins.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${r.weight ? `<p>${esc(r.weight)}</p>` : ''}
    <p style="font-weight:900">🎯 Pour la semaine qui vient</p>
    <ul>${r.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  </div>`;
}
function viewMore() {
  return `
  <h1 class="page-title">Mon dojo</h1>

  <section class="card">
    <div class="card-head"><h2 class="c-yellow">Bilans hebdo</h2><span class="meta">chaque lundi</span></div>
    ${S.reviews.length ? reviewHTML(S.reviews[0]) : '<p class="muted">Ton premier bilan arrivera lundi prochain. En attendant, tu peux regarder la semaine en cours.</p>'}
    ${S.reviews.length > 1 ? `<label class="lbl">Bilans précédents</label><div class="chips">${S.reviews.slice(1, 13).map((r) => `<button class="chip" data-action="open-review" data-ws="${r.ws}">${fmtDate(r.ws, { day: 'numeric', month: 'short' })}</button>`).join('')}</div>` : ''}
    <button class="btn btn-sm mt" data-action="current-review">Voir la semaine en cours</button>
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-pink">Badges</h2><span class="meta">${Object.keys(S.badges).length}/${BADGES.length}</span></div>
    <div class="badges">${BADGES.map((b) => `<div class="badge ${S.badges[b.id] ? 'got' : 'locked'}" title="${esc(b.ds)}"><div class="ic">${b.ic}</div><div class="nm">${esc(b.nm)}</div><div class="sub" style="font-size:10px;color:var(--muted);font-weight:700">${esc(b.ds)}</div></div>`).join('')}</div>
    <p class="small-note">Pas de série à ne jamais casser ici : un jour raté ne fait rien perdre.</p>
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-orange">Plans « si… alors… »</h2></div>
    <p class="muted" style="margin-top:0">Ils s’affichent quand tu déclares une envie avec le même déclencheur.</p>
    <ul class="list">${S.plans.map((p) => `<li class="item"><div class="grow"><div class="txt">Si ${esc(p.ifTxt)}, alors ${esc(p.thenTxt)}.</div><div class="sub">${esc(p.trigger)}</div></div><button class="icon-btn" data-action="plan-del" data-id="${p.id}">✕</button></li>`).join('')}</ul>
    <button class="btn btn-sm mt" data-action="plan-new">+ Nouveau plan</button>
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-cyan">Mes tâches de ménage</h2></div>
    <ul class="list">${S.chores.map((c) => `<li class="item"><div class="grow"><div class="txt">${esc(c.name)}</div><div class="sub">${esc(c.zone)} · ${freqLabel(c.freq)} · ${c.minutes} min</div></div><button class="icon-btn" data-action="chore-edit" data-id="${c.id}">✎</button><button class="icon-btn" data-action="chore-del" data-id="${c.id}">✕</button></li>`).join('')}</ul>
    <button class="btn btn-sm mt" data-action="chore-new">+ Nouvelle tâche</button>
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-violet">Réglages</h2></div>
    <form data-form="settings">
      <label class="lbl" for="sn">Prénom</label>
      <input class="input" id="sn" name="name" value="${esc(S.profile.name)}" maxlength="30">
      <label class="lbl" for="sg">Objectif de séances de sport par semaine</label>
      <input class="input" id="sg" name="goal" type="number" min="1" max="14" value="${S.profile.sportGoal}">
      <button class="btn btn-cyan mt" type="submit">Enregistrer</button>
    </form>
    <hr class="dash">
    <p style="font-weight:900;margin:0 0 6px">🔔 Notifications</p>
    <p class="muted" style="margin-top:0">Les rappels du matin, du midi et du soir arrivent par l’appli gratuite <b>ntfy</b> (voir le guide dans le README du projet). Ici, tu peux autoriser l’alerte de fin du minuteur d’envie.</p>
    <button class="btn btn-sm" data-action="notif-perm">${'Notification' in window && Notification.permission === 'granted' ? '✓ Notifications autorisées' : 'Autoriser les notifications'}</button>
    <hr class="dash">
    <p style="font-weight:900;margin:0 0 6px">💾 Sauvegarde</p>
    <p class="muted" style="margin-top:0">Le fichier est chiffré : il faudra ton mot de passe pour le réimporter. Fais-en une par semaine.</p>
    <div class="row wrap">
      <button class="btn btn-sm btn-yellow" data-action="export">Exporter</button>
      <button class="btn btn-sm" data-action="import">Importer</button>
    </div>
    <hr class="dash">
    <div class="row wrap">
      <button class="btn btn-sm" data-action="change-pw">Changer le mot de passe</button>
      <button class="btn btn-sm" data-action="lock">🔒 Verrouiller</button>
      <button class="btn btn-sm" data-action="reset" style="color:#d00045">Tout effacer</button>
    </div>
    <p class="small-note">Mon Dojo · V1 · données chiffrées sur cet appareil uniquement.</p>
  </section>
`;
}

// ======================================================================
// Modales : envie, séance, respiration, etc.
// ======================================================================
function cravingStartModal() {
  let intensity = 3, trigger = null;
  const draw = () => {
    openModal(`
      <h2>🌊 Une vague arrive</h2>
      <p style="margin-top:0;font-weight:700">C’est normal, et ça va passer. Deux infos en 5 secondes :</p>
      <label class="lbl">Intensité</label>
      <div class="chips">${[1, 2, 3, 4, 5].map((i) => `<button class="chip ${intensity === i ? 'on' : ''}" data-m="int" data-v="${i}">${'🔥'.repeat(i)}</button>`).join('')}</div>
      <label class="lbl">Qu’est-ce qui la déclenche ?</label>
      <div class="chips">${TRIGGERS.map((tr) => `<button class="chip ${trigger === tr ? 'on' : ''}" data-m="trig" data-v="${esc(tr)}">${esc(tr)}</button>`).join('')}</div>
      <button class="btn btn-primary btn-big btn-block mt" data-m="go">Lancer les 15 minutes</button>
      <button class="btn btn-ghost btn-block mt" data-m="cancel">Annuler</button>
    `);
    $('.modal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      const m = b.dataset.m;
      if (m === 'int') { intensity = +b.dataset.v; draw(); }
      else if (m === 'trig') { trigger = b.dataset.v; draw(); }
      else if (m === 'cancel') closeModal();
      else if (m === 'go') {
        const now = Date.now();
        S.cravings.push({ id: uid(), date: todayKey(), ts: now, end: now + 15 * 60000, intensity, trigger: trigger || 'Autre', outcome: 'pending' });
        save();
        scheduleCravingNotif();
        cravingTimerModal();
      }
    });
  };
  draw();
}
function scheduleCravingNotif() {
  const p = pendingCraving(); if (!p) return;
  clearTimeout(window.__cn);
  window.__cn = setTimeout(() => notify('La vague est passée ? 🌊', 'Tes 15 minutes sont écoulées. Viens dire comment ça s’est passé.'), Math.max(0, p.end - Date.now()));
}
async function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [80, 40, 80] });
    else new Notification(title, { body });
  } catch { /* ignore */ }
}
function cravingTimerModal() {
  const p = pendingCraving(); if (!p) return;
  const plan = S.plans.find((x) => x.trigger === p.trigger);
  const R = 88, C = 2 * Math.PI * R;
  openModal(`
    <h2>Surfe la vague</h2>
    <div class="timer-ring">
      <svg width="200" height="200" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="${R}" fill="#fff" stroke="#1a1033" stroke-width="16"/>
        <circle cx="100" cy="100" r="${R}" fill="none" stroke="#e8def5" stroke-width="10"/>
        <circle id="ringArc" cx="100" cy="100" r="${R}" fill="none" stroke="#ff3d7f" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0"/>
      </svg>
      <div class="t" id="ringT">15:00</div>
    </div>
    ${plan ? `<div class="plan-box">📋 Ton plan : si ${esc(plan.ifTxt)}, alors ${esc(plan.thenTxt)}.</div>` : ''}
    <ul class="tips">
      <li>Bois un grand verre d’eau 💧</li>
      <li>Bouge 5 minutes : marche, escaliers, pompes</li>
      <li>Change de pièce, éloigne-toi de la nourriture</li>
      <li>Observe l’envie sans lui obéir : elle monte, puis redescend</li>
      <li>Si tu as vraiment faim : un vrai repas avec des protéines</li>
    </ul>
    <button class="btn btn-violet btn-block mt" data-m="breath">🧘 1 minute de respiration</button>
    <div class="row mt">
      <button class="btn btn-green grow" data-m="surfed">L’envie est passée 💪</button>
      <button class="btn grow" data-m="gave">J’ai craqué</button>
    </div>
    <button class="btn btn-ghost btn-block mt" data-m="hide">Fermer (le minuteur continue)</button>
  `);
  const tick = () => {
    const left = Math.max(0, p.end - Date.now());
    const el = $('#ringT'); if (!el) return;
    el.textContent = left ? fmtMs(left) : 'BRAVO';
    $('#ringArc').setAttribute('stroke-dashoffset', String(C * (1 - left / (15 * 60000))));
  };
  tick(); modalTick = setInterval(tick, 1000);
  $('.modal').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const m = b.dataset.m;
    if (m === 'hide') { closeModal(); render(); }
    else if (m === 'breath') { breathModal(1, () => cravingTimerModal()); }
    else if (m === 'surfed' || m === 'gave') {
      p.outcome = m; p.closedAt = Date.now();
      clearTimeout(window.__cn);
      closeModal();
      if (m === 'surfed') award(25, 'VICTOIRE !', 'Vague surfée');
      else {
        award(5, '', 'Merci pour ton honnêteté');
        openModal(`<h2>Pas grave. Vraiment.</h2>
          <p style="font-weight:700">Un écart n’est pas une rechute. Pas de compensation, pas de punition : tu reprends normalement au prochain repas.</p>
          <p style="font-weight:700">Ce que tu viens de noter t’aide à repérer tes déclencheurs. C’est comme ça qu’on gagne sur la durée.</p>
          <button class="btn btn-primary btn-block mt" data-action="modal-close">Je repars</button>`);
      }
      render();
    }
  });
}
function workoutModal() {
  const types = ['Muscu', 'Course', 'Marche rapide', 'Vélo', 'Natation', 'Foot / sport co', 'Yoga / étirements', 'Randonnée', 'Autre'];
  let type = S.plannedWorkouts[todayKey()] || 'Muscu', minutes = 30, intensity = 3;
  const draw = () => {
    openModal(`
      <h2>💥 Séance terminée !</h2>
      <label class="lbl">Type</label>
      <div class="chips">${types.map((x) => `<button class="chip ${type === x ? 'on' : ''}" data-m="type" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <label class="lbl">Durée</label>
      <div class="chips">${[15, 20, 30, 45, 60, 90].map((x) => `<button class="chip ${minutes === x ? 'on' : ''}" data-m="min" data-v="${x}">${x} min</button>`).join('')}</div>
      <label class="lbl">Intensité ressentie</label>
      <div class="chips">${[1, 2, 3, 4, 5].map((x) => `<button class="chip ${intensity === x ? 'on' : ''}" data-m="int" data-v="${x}">${x}</button>`).join('')}</div>
      <label class="lbl" for="wn">Note (facultatif)</label>
      <input class="input" id="wn" maxlength="160" placeholder="Ex. squat 3×10 à 40 kg">
      <button class="btn btn-green btn-big btn-block mt" data-m="ok">Valider</button>
      <button class="btn btn-ghost btn-block mt" data-m="cancel">Annuler</button>`);
    $('.modal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      const m = b.dataset.m;
      const note = $('#wn')?.value || '';
      if (m === 'type') { type = b.dataset.v; draw(); $('#wn').value = note; }
      else if (m === 'min') { minutes = +b.dataset.v; draw(); $('#wn').value = note; }
      else if (m === 'int') { intensity = +b.dataset.v; draw(); $('#wn').value = note; }
      else if (m === 'cancel') closeModal();
      else if (m === 'ok') {
        S.workouts.push({ id: uid(), date: todayKey(), type, minutes, intensity, note });
        closeModal(); award(30, 'DOOON !', 'Séance validée'); render();
      }
    });
  };
  draw();
}
function breathModal(minutes, after) {
  const total = minutes * 60;
  let elapsed = 0;
  openModal(`
    <h2>🧘 Respire</h2>
    <div class="breath-stage"><div class="breath-circle" id="bc"></div></div>
    <div class="breath-label" id="bl">Prêt…</div>
    <p class="center muted" id="bt">${minutes}:00</p>
    <button class="btn btn-ghost btn-block mt" data-m="stop">Arrêter</button>`);
  const bc = $('#bc'), bl = $('#bl'), bt = $('#bt');
  let phase = 0;
  const step = () => {
    if (!bc.isConnected) return;
    if (elapsed >= total) {
      clearInterval(modalTick);
      const d = day(); d.breath = (d.breath || 0) + 1;
      closeModal(); award(10, 'ZEN…', 'Respiration');
      if (after) after(); else render();
      return;
    }
    if (elapsed % 5 === 0) {
      phase = (elapsed / 5) % 2;
      bc.classList.toggle('in', phase === 0);
      bl.textContent = phase === 0 ? 'Inspire…' : 'Expire…';
      if (navigator.vibrate) navigator.vibrate(30);
    }
    const left = total - elapsed;
    bt.textContent = `${Math.floor(left / 60)}:${pad(left % 60)}`;
    elapsed++;
  };
  setTimeout(() => { step(); modalTick = setInterval(step, 1000); }, 400);
  $('.modal').addEventListener('click', (e) => {
    if (e.target.closest('[data-m="stop"]')) { closeModal(); if (after) after(); else render(); }
  });
}
function choreModal(ch) {
  const isNew = !ch;
  const c = ch ? JSON.parse(JSON.stringify(ch)) : { id: uid(), name: '', zone: 'Maison', freq: { type: 'weekly', days: [weekdayIdx(todayKey())] }, minutes: 10 };
  const draw = () => {
    const name = $('#cn')?.value ?? c.name, zone = $('#cz')?.value ?? c.zone, min = $('#cm')?.value ?? c.minutes, n = $('#cnn')?.value ?? c.freq.n ?? 3;
    c.name = name; c.zone = zone; c.minutes = +min || 10; if (c.freq.type === 'every') c.freq.n = Math.max(2, +n || 3);
    openModal(`
      <h2>${isNew ? 'Nouvelle tâche' : 'Modifier la tâche'}</h2>
      <label class="lbl" for="cn">Tâche</label><input class="input" id="cn" value="${esc(c.name)}" maxlength="80" placeholder="Ex. Nettoyer les vitres">
      <label class="lbl" for="cz">Zone</label><input class="input" id="cz" value="${esc(c.zone)}" maxlength="40">
      <label class="lbl">Fréquence</label>
      <div class="chips">
        <button class="chip ${c.freq.type === 'daily' ? 'on' : ''}" data-m="ft" data-v="daily">Tous les jours</button>
        <button class="chip ${c.freq.type === 'weekly' ? 'on' : ''}" data-m="ft" data-v="weekly">Jours fixes</button>
        <button class="chip ${c.freq.type === 'every' ? 'on' : ''}" data-m="ft" data-v="every">Tous les X jours</button>
      </div>
      ${c.freq.type === 'weekly' ? `<div class="chips mt">${WD.map((w, i) => `<button class="chip ${(c.freq.days || []).includes(i) ? 'on' : ''}" data-m="wd" data-v="${i}">${w}</button>`).join('')}</div>` : ''}
      ${c.freq.type === 'every' ? `<div class="row mt"><span style="font-weight:800">Tous les</span><input class="input" style="width:80px" id="cnn" type="number" min="2" max="90" value="${c.freq.n || 3}"><span style="font-weight:800">jours</span></div>` : ''}
      <label class="lbl" for="cm">Durée estimée (min)</label><input class="input" id="cm" type="number" min="1" max="240" value="${c.minutes}">
      <button class="btn btn-primary btn-block mt" data-m="ok">Enregistrer</button>
      <button class="btn btn-ghost btn-block mt" data-m="cancel">Annuler</button>`);
    $('.modal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      const m = b.dataset.m;
      if (m === 'ft') {
        const v = b.dataset.v;
        c.freq = v === 'daily' ? { type: 'daily' } : v === 'weekly' ? { type: 'weekly', days: c.freq.days || [weekdayIdx(todayKey())] } : { type: 'every', n: c.freq.n || 3 };
        draw();
      } else if (m === 'wd') {
        const i = +b.dataset.v; const s = new Set(c.freq.days || []); s.has(i) ? s.delete(i) : s.add(i); c.freq.days = [...s].sort(); draw();
      } else if (m === 'cancel') closeModal();
      else if (m === 'ok') {
        c.name = $('#cn').value.trim(); c.zone = $('#cz').value.trim() || 'Maison'; c.minutes = +$('#cm').value || 10;
        if (c.freq.type === 'every') c.freq.n = Math.max(2, +$('#cnn').value || 3);
        if (!c.name) return toast('Donne un nom à la tâche');
        if (isNew) S.chores.push(c); else S.chores[S.chores.findIndex((x) => x.id === c.id)] = c;
        save(); closeModal(); render();
      }
    });
  };
  draw();
}
function planModal() {
  let trigger = 'Fatigue';
  const draw = () => {
    const i = $('#pi')?.value || '', th = $('#pt')?.value || '';
    openModal(`
      <h2>Plan « si… alors… »</h2>
      <label class="lbl">Déclencheur</label>
      <div class="chips">${TRIGGERS.map((tr) => `<button class="chip ${trigger === tr ? 'on' : ''}" data-m="trig" data-v="${esc(tr)}">${esc(tr)}</button>`).join('')}</div>
      <label class="lbl" for="pi">Si…</label><input class="input" id="pi" maxlength="140" placeholder="je rentre du travail stressé" value="${esc(i)}">
      <label class="lbl" for="pt">Alors…</label><input class="input" id="pt" maxlength="140" placeholder="je bois un thé et je marche 5 minutes" value="${esc(th)}">
      <button class="btn btn-primary btn-block mt" data-m="ok">Enregistrer</button>
      <button class="btn btn-ghost btn-block mt" data-m="cancel">Annuler</button>`);
    $('.modal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      if (b.dataset.m === 'trig') { trigger = b.dataset.v; draw(); }
      else if (b.dataset.m === 'cancel') closeModal();
      else if (b.dataset.m === 'ok') {
        const ifTxt = $('#pi').value.trim(), thenTxt = $('#pt').value.trim();
        if (!ifTxt || !thenTxt) return toast('Remplis les deux parties');
        S.plans.push({ id: uid(), trigger, ifTxt, thenTxt }); save(); closeModal(); render();
      }
    });
  };
  draw();
}
function promptModal(title, label, { type = 'text', value = '', placeholder = '' } = {}, onOk) {
  openModal(`<h2>${esc(title)}</h2>
    <form id="pf"><label class="lbl" for="pv">${esc(label)}</label>
    <input class="input" id="pv" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${type === 'number' ? 'step="0.5" inputmode="decimal"' : ''} maxlength="120" autofocus>
    <button class="btn btn-primary btn-block mt" type="submit">OK</button>
    <button class="btn btn-ghost btn-block mt" type="button" data-action="modal-close">Annuler</button></form>`);
  $('#pf').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#pv').value.trim(); closeModal(); onOk(v); });
  setTimeout(() => $('#pv')?.focus(), 50);
}
function changePwModal() {
  openModal(`<h2>Changer le mot de passe</h2>
    <form id="cpf">
      <label class="lbl" for="op">Mot de passe actuel</label><input class="input" id="op" type="password" required>
      <label class="lbl" for="np">Nouveau</label><input class="input" id="np" type="password" minlength="4" required>
      <label class="lbl" for="np2">Encore une fois</label><input class="input" id="np2" type="password" required>
      <div class="err" id="cpe"></div>
      <button class="btn btn-primary btn-block mt" type="submit">Changer</button>
      <button class="btn btn-ghost btn-block mt" type="button" data-action="modal-close">Annuler</button>
    </form>`);
  $('#cpf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#cpe');
    try { await decryptJSON(readBlob(), $('#op').value); } catch { err.textContent = 'Mot de passe actuel incorrect.'; return; }
    const np = $('#np').value;
    if (np.length < 4) { err.textContent = '4 caractères minimum.'; return; }
    if (np !== $('#np2').value) { err.textContent = 'Les deux mots de passe sont différents.'; return; }
    SALT = crypto.getRandomValues(new Uint8Array(16));
    KEY = await deriveKey(np, SALT);
    await saveNow();
    closeModal(); toast('Mot de passe changé', 'OK !');
  });
}

// ======================================================================
// Sauvegarde : export / import
// ======================================================================
async function exportBackup() {
  await saveNow();
  const blob = new Blob([localStorage.getItem(STORE_KEY)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mon-dojo-sauvegarde-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Sauvegarde téléchargée', 'SAUVÉ !');
}
function importBackup() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let blob;
    try { blob = JSON.parse(await f.text()); if (blob.app !== 'mon-dojo' || !blob.ct) throw 0; } catch { return toast('Fichier non reconnu'); }
    promptModal('Importer une sauvegarde', 'Mot de passe de cette sauvegarde', { type: 'password' }, async (pw) => {
      try {
        const r = await decryptJSON(blob, pw);
        S = migrate(r.data); KEY = r.key; SALT = r.salt;
        await saveNow(); toast('Sauvegarde importée', 'OK !'); start();
      } catch { toast('Mot de passe incorrect pour ce fichier'); }
    });
  };
  inp.click();
}

// ======================================================================
// Actions (délégation d'événements)
// ======================================================================
document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-route]');
  if (r) { e.preventDefault(); setRoute(r.dataset.route); return; }
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  if (act === 'modal-bg') { if (e.target === a) { closeModal(); render(); } return; }
  if (act === 'modal-close') { closeModal(); render(); return; }
  if (act === 'close-levelup') { $('#overlay').innerHTML = ''; return; }
  if (act === 'import') { importBackup(); return; }
  if (!S) return;
  const t = todayKey();
  const d = day(t);
  switch (act) {
    case 'prio-toggle': {
      const p = d.priorities[+a.dataset.i]; p.done = !p.done;
      if (p.done) award(10, 'BAM !', 'Priorité accomplie'); else { S.xp = Math.max(0, S.xp - 10); save(); }
      render(); break;
    }
    case 'prio-del': d.priorities.splice(+a.dataset.i, 1); save(); render(); break;
    case 'inbox-del': S.inbox = S.inbox.filter((x) => x.id !== a.dataset.id); save(); render(); break;
    case 'inbox-promote': {
      const x = S.inbox.find((y) => y.id === a.dataset.id);
      if (x && d.priorities.length < 3) { d.priorities.push({ t: x.t, done: false }); S.inbox = S.inbox.filter((y) => y !== x); save(); render(); }
      break;
    }
    case 'mood': {
      const first = !d.mood; d.mood = +a.dataset.v;
      if (first) award(15, 'CHECK !', 'Check-in'); else save();
      render(); break;
    }
    case 'sleep': d.sleep = +a.dataset.v; save(); render(); break;
    case 'sleep-other':
      promptModal('Sommeil', 'Nombre d’heures (ex. 6,5)', { type: 'number', value: d.sleep || '' }, (v) => {
        const n = parseFloat(String(v).replace(',', '.'));
        if (n > 0 && n < 16) { d.sleep = n; save(); } render();
      });
      break;
    case 'chore-toggle': {
      const ch = S.chores.find((c) => c.id === a.dataset.id);
      if (choreDoneOn(ch, t)) { S.choreLog = S.choreLog.filter((l) => !(l.choreId === ch.id && l.date === t)); S.xp = Math.max(0, S.xp - 10); save(); }
      else { S.choreLog.push({ id: uid(), choreId: ch.id, date: t }); ch.last = t; award(10, ['PAF !', 'ZIP !', 'SHLAK !', 'POW !'][S.choreLog.length % 4], ch.name); }
      render(); break;
    }
    case 'craving-start': cravingStartModal(); break;
    case 'craving-open': cravingTimerModal(); break;
    case 'workout-open': workoutModal(); break;
    case 'workout-del': S.workouts = S.workouts.filter((w) => w.id !== a.dataset.id); S.xp = Math.max(0, S.xp - 30); save(); render(); break;
    case 'breath': breathModal(+a.dataset.min); break;
    case 'open-review': {
      const rv = S.reviews.find((x) => x.ws === a.dataset.ws);
      if (rv) {
        if (S.reviews[0]?.ws === rv.ws && S.seenReview !== rv.ws) { S.seenReview = rv.ws; award(20, 'STRATÈGE !', 'Bilan lu'); }
        openModal(reviewHTML(rv) + '<button class="btn btn-primary btn-block mt" data-action="modal-close">Fermer</button>');
      }
      break;
    }
    case 'current-review': {
      const st = weekStats(weekStart(t));
      openModal(reviewHTML({ ...st, ...reviewText(st) }) + '<p class="small-note">Semaine en cours : le bilan définitif sera prêt lundi.</p><button class="btn btn-primary btn-block mt" data-action="modal-close">Fermer</button>');
      break;
    }
    case 'range': statsRange = +a.dataset.v; render(); break;
    case 'plan-prio': {
      const k = a.dataset.k;
      promptModal(`Priorité pour ${fmtDate(k, { weekday: 'long', day: 'numeric' })}`, 'Quoi ?', {}, (v) => {
        if (v) { const dd = day(k); if (dd.priorities.length < 3) dd.priorities.push({ t: v, done: false }); save(); } render();
      });
      break;
    }
    case 'plan-sport': {
      const k = a.dataset.k;
      const types = ['Muscu', 'Course', 'Marche rapide', 'Vélo', 'Natation', 'Foot / sport co', 'Yoga / étirements', 'Randonnée'];
      openModal(`<h2>Séance prévue ${esc(fmtDate(k, { weekday: 'long' }))}</h2>
        <div class="chips">${types.map((x) => `<button class="chip ${S.plannedWorkouts[k] === x ? 'on' : ''}" data-action="plan-sport-set" data-k="${k}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        ${S.plannedWorkouts[k] ? `<button class="btn btn-ghost btn-block mt" data-action="plan-sport-set" data-k="${k}" data-v="">Retirer</button>` : ''}
        <button class="btn btn-ghost btn-block mt" data-action="modal-close">Fermer</button>`);
      break;
    }
    case 'plan-sport-set': {
      if (a.dataset.v) S.plannedWorkouts[a.dataset.k] = a.dataset.v; else delete S.plannedWorkouts[a.dataset.k];
      save(); closeModal(); render(); break;
    }
    case 'plan-new': planModal(); break;
    case 'plan-del': S.plans = S.plans.filter((p) => p.id !== a.dataset.id); save(); render(); break;
    case 'chore-new': choreModal(null); break;
    case 'chore-edit': choreModal(S.chores.find((c) => c.id === a.dataset.id)); break;
    case 'chore-del': {
      const ch = S.chores.find((c) => c.id === a.dataset.id);
      openModal(`<h2>Supprimer ?</h2><p style="font-weight:700">« ${esc(ch.name)} » ne sera plus proposée.</p>
        <button class="btn btn-primary btn-block" data-action="chore-del-ok" data-id="${ch.id}">Supprimer</button>
        <button class="btn btn-ghost btn-block mt" data-action="modal-close">Annuler</button>`);
      break;
    }
    case 'chore-del-ok': S.chores = S.chores.filter((c) => c.id !== a.dataset.id); save(); closeModal(); render(); break;
    case 'notif-perm':
      if (!('Notification' in window)) { toast('Ton navigateur ne gère pas les notifications. Sur iPhone, ajoute d’abord l’appli à l’écran d’accueil.'); break; }
      Notification.requestPermission().then((p) => { if (p === 'granted') notify('Mon Dojo', 'Les notifications sont activées 💥'); render(); });
      break;
    case 'export': exportBackup(); break;
    case 'change-pw': changePwModal(); break;
    case 'lock': lock(); break;
    case 'reset':
      openModal(`<h2>Tout effacer ?</h2><p style="font-weight:700">Toutes tes données seront supprimées de ce téléphone. Exporte une sauvegarde avant si tu veux les garder.</p>
        <button class="btn btn-primary btn-block" data-action="reset-ok">Oui, tout effacer</button>
        <button class="btn btn-ghost btn-block mt" data-action="modal-close">Annuler</button>`);
      break;
    case 'reset-ok': localStorage.removeItem(STORE_KEY); S = null; KEY = null; closeModal(); renderLock(); break;
  }
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]');
  if (!f || !S) return;
  e.preventDefault();
  const t = todayKey();
  const d = day(t);
  const val = (n) => (f.elements[n]?.value || '').trim();
  switch (f.dataset.form) {
    case 'prio-add': { const v = val('t'); if (v && d.priorities.length < 3) { d.priorities.push({ t: v, done: false }); save(); render(); setTimeout(() => $('[data-form="prio-add"] input')?.focus(), 0); } break; }
    case 'inbox-add': { const v = val('t'); if (v) { S.inbox.unshift({ id: uid(), t: v, date: t }); save(); render(); toast('Noté, tu peux oublier 🧠'); } break; }
    case 'weight': {
      const n = parseFloat(val('w').replace(',', '.'));
      if (n > 20 && n < 400) { const first = !d.weight; d.weight = Math.round(n * 10) / 10; if (first) award(5, 'NOTÉ !', 'Pesée'); else save(); render(); }
      break;
    }
    case 'gratitude': { const v = val('g'); const first = !d.gratitude; d.gratitude = v; if (v && first) award(5, 'MERCI !', 'Gratitude'); else save(); render(); break; }
    case 'settings': {
      S.profile.name = val('name') || S.profile.name;
      S.profile.sportGoal = clamp(parseInt(val('goal'), 10) || 3, 1, 14);
      save(); toast('Réglages enregistrés', 'OK !'); render(); break;
    }
  }
});

// ======================================================================
// Démarrage, verrouillage automatique
// ======================================================================
function lock() { saveNow(); S = null; KEY = null; SALT = null; closeModal(); renderLock(); }
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); saveNow(); }
  else if (S && hiddenAt && Date.now() - hiddenAt > 10 * 60000) lock();
  else if (S) { render(); }
});
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.some((x) => x[0] === h) && h !== route) { route = h; render(); } });

function start() {
  const h = location.hash.slice(1);
  route = TABS.some((x) => x[0] === h) ? h : 'today';
  generateReviews();
  checkBadges();
  scheduleCravingNotif();
  render();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (!window.crypto?.subtle) {
  $('#app').innerHTML = '<div class="card" style="margin-top:40px">Cette page doit être ouverte en https pour protéger tes données.</div>';
} else {
  renderLock();
}
})();
