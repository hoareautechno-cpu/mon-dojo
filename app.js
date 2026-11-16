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
// Personnes du foyer : « me » = l'utilisateur. Les autres reçoivent des tâches déléguées.
function defaultPeople(name) {
  return [
    { id: 'me', name: name || 'Moi', emoji: '👨' },
    { id: 'p-maman', name: 'Maman', emoji: '👩', role: 'partner' },
    { id: 'p-ado', name: 'Ado', emoji: '🧑', role: 'child' },
    { id: 'p-petite', name: 'Petite', emoji: '👧', role: 'child' },
  ];
}
const person = (id) => S.people.find((p) => p.id === (id || 'me')) || S.people[0];
const isMine = (c) => !c.who || c.who === 'me';
const mineLog = () => S.choreLog.filter((l) => !l.who || l.who === 'me');

// Planning familial (tableau des tâches de la maison)
function familyChores() {
  const c = (name, zone, who, freq, minutes = 10) => ({ id: uid(), name, zone, who, freq, minutes, last: null });
  const ws = weekStart(todayKey());
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  return [
    c('🍳 Préparer le repas', 'Cuisine', 'me', { type: 'daily' }, 45),
    c('🧺 Lessive (1 sem. sur 2)', 'Linge', 'me', { type: 'weekly', days: [2], alt: true, anchor: ws }, 20),
    c('🛁 Salle de bain + toilettes', 'Salle de bain', 'me', { type: 'weekly', days: [5] }, 30),
    c('🧹 Rangement tous ensemble (30 min)', 'Maison', 'me', { type: 'weekly', days: [6] }, 30),
    c('🍽 Vaisselle / lave-vaisselle', 'Cuisine', 'p-maman', { type: 'daily' }, 15),
    c('🧺 Lessive (1 sem. sur 2)', 'Linge', 'p-maman', { type: 'weekly', days: [2], alt: true, anchor: addDays(ws, 7) }, 20),
    c('🛒 Courses', 'Courses', 'p-maman', { type: 'weekly', days: [5] }, 60),
    c('🧹 Rangement tous ensemble (30 min)', 'Maison', 'p-maman', { type: 'weekly', days: [6] }, 30),
    c('🍴 Mettre et débarrasser la table', 'Cuisine', 'p-ado', { type: 'weekly', days: ALL }, 10),
    c('🗑 Sortir les poubelles (soir)', 'Maison', 'p-ado', { type: 'weekly', days: [0, 3] }, 5),
    c('♻️ Sortir le recyclable (1 sem. sur 2)', 'Maison', 'p-ado', { type: 'weekly', days: [2], alt: true, anchor: ws }, 5),
    c('🧹 Aspirateur salon + sa chambre', 'Salon', 'p-ado', { type: 'weekly', days: [2] }, 20),
    c('🛏 Ranger sa chambre', 'Chambres', 'p-ado', { type: 'weekly', days: [5] }, 15),
    c('🧹 Rangement tous ensemble (30 min)', 'Maison', 'p-ado', { type: 'weekly', days: [6] }, 30),
    c('🧸 Ranger ses jouets', 'Chambres', 'p-petite', { type: 'daily' }, 10),
    c('👕 Linge sale au panier', 'Linge', 'p-petite', { type: 'daily' }, 2),
    c('👚 Aider à plier le linge', 'Linge', 'p-petite', { type: 'weekly', days: [2] }, 10),
    c('🪴 Arroser les plantes (avec un adulte)', 'Maison', 'p-petite', { type: 'weekly', days: [5] }, 5),
    c('🧹 Rangement tous ensemble (30 min)', 'Maison', 'p-petite', { type: 'weekly', days: [6] }, 30),
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
    people: defaultPeople(name),
    chores: defaultChores(),
    choreLog: [],
    cravings: [],
    workouts: [],
    plannedWorkouts: {},
    plans: defaultPlans(),
    xp: 0,
    badges: {},
    reviews: [],
    finance: defaultFinance(),
    projects: [],
    family: { couple: {}, dates: {} },
    settings: defaultSettings(),
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
  if (f.type === 'weekly') {
    if (!(f.days || []).includes(weekdayIdx(k))) return false;
    if (f.alt) return Math.abs(diffDays(weekStart(f.anchor || k), weekStart(k)) / 7) % 2 === 0;
    return true;
  }
  if (f.type === 'once') {
    if (k === f.date) return true;
    return k === todayKey() && f.date < k && !S.choreLog.some((l) => l.choreId === ch.id);
  }
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
  if (f.type === 'once') return k === f.date;
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
  if (f.type === 'weekly') return ((f.days || []).length === 7 ? 'Tous les jours' : (f.days || []).map((d) => WD[d]).join(', ') || 'Jamais') + (f.alt ? ' (1 sem. sur 2)' : '');
  if (f.type === 'once') return 'Une fois, ' + fmtDate(f.date, { weekday: 'short', day: 'numeric', month: 'short' });
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
  if (S.finance?.expenses.some((e) => e.date === k)) return true;
  if (d && d.moments && Object.values(d.moments).some(Boolean)) return true;
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
  { id: 'menage30', ic: '🧹', nm: 'Maison nickel', ds: '30 tâches de ménage', t: () => mineLog().length >= 30 },
  { id: 'menage100', ic: '🥷', nm: 'Ninja du ménage', ds: '100 tâches de ménage', t: () => mineLog().length >= 100 },
  { id: 'zen10', ic: '🧘', nm: 'Esprit zen', ds: '10 respirations guidées', t: () => Object.values(S.days).reduce((a, d) => a + (d.breath || 0), 0) >= 10 },
  { id: 'merci7', ic: '🙏', nm: 'Gratitude', ds: '7 gratitudes notées', t: () => Object.values(S.days).filter((d) => d.gratitude).length >= 7 },
  { id: 'balance5', ic: '⚖️', nm: 'Suivi poids', ds: '5 pesées', t: () => Object.values(S.days).filter((d) => d.weight).length >= 5 },
  { id: 'regulier', ic: '📅', nm: 'Régulier', ds: '5 jours actifs dans une semaine', t: () => anyWeek((ks) => ks.filter(isActive).length >= 5) },
  { id: 'sommeil', ic: '😴', nm: 'Gardien du sommeil', ds: '7 nuits de 7 h ou plus', t: () => Object.values(S.days).filter((d) => d.sleep >= 7).length >= 7 },
  { id: 'argent7', ic: '💶', nm: 'Trésorier', ds: 'Dépenses notées 7 jours sur 10', t: () => { const t = todayKey(); return [...Array(10)].map((_, i) => addDays(t, -i)).filter((k) => S.finance.expenses.some((e) => e.date === k)).length >= 7; } },
  { id: 'budget', ic: '🛡️', nm: 'Gardien du budget', ds: 'Un mois complet dans tous tes budgets', t: () => budgetMonthOk() },
  { id: 'econome', ic: '🐷', nm: 'Économe', ds: '100 € économisés grâce aux 48 h', t: () => sum(S.finance.waitlist.filter((w) => w.status === 'dropped')) >= 100 },
  { id: 'projet', ic: '🚀', nm: 'Bâtisseur', ds: '10 actions sur tes projets perso', t: () => S.projects.reduce((a, p) => a + p.tasks.filter((t) => t.done).length, 0) >= 10 },
  { id: 'projet-fini', ic: '🏁', nm: 'Mission accomplie', ds: 'Terminer un projet perso', t: () => S.projects.some((p) => p.archived && p.tasks.length && p.tasks.every((t) => t.done)) },
  { id: 'papa', ic: '🫶', nm: 'Papa présent', ds: '20 moments rien qu’à eux', t: () => Object.values(S.days).reduce((a, d) => a + Object.values(d.moments || {}).filter(Boolean).length, 0) >= 20 },
  { id: 'couple', ic: '💞', nm: 'Équipe de choc', ds: '4 points couple', t: () => Object.values(S.family.couple).filter(Boolean).length >= 4 },
  { id: 'bilan', ic: '📜', nm: 'Stratège', ds: 'Lire un bilan hebdo', t: () => !!S.seenReview },
  { id: 'niveau5', ic: '⭐', nm: 'Samouraï', ds: 'Atteindre le niveau 5', t: () => levelInfo(S.xp).level >= 5 },
];
function budgetMonthOk() {
  const cats = S.finance.categories.filter((c) => c.budget);
  if (!cats.length) return false;
  let m = monthOf(S.createdAt); const cur = monthOf(todayKey());
  while (m < cur) {
    const ex = monthExp(m);
    if (ex.length && cats.every((c) => sum(ex.filter((e) => e.cat === c.id)) <= c.budget)) return true;
    m = addMonths(m, 1);
  }
  return false;
}
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
    chores: mineLog().filter((l) => inW(l.date)).length,
    delegated: S.choreLog.filter((l) => inW(l.date) && l.who && l.who !== 'me').length,
    prios: days.reduce((a, d) => a + (d.priorities || []).filter((p) => p.done).length, 0),
    cravings: cr.length,
    surfed: cr.filter((c) => c.outcome === 'surfed').length,
    topTrigger,
    mood: avg(moods),
    sleep: avg(sleeps),
    weightStart: weights[0] ?? null,
    weightEnd: weights[weights.length - 1] ?? null,
    breath: days.reduce((a, d) => a + (d.breath || 0), 0),
    spent: sum(S.finance.expenses.filter((e) => inW(e.date))),
    snacks: sum(S.finance.expenses.filter((e) => inW(e.date) && e.cat === 'snacks')),
    topCat: (() => { const by = {}; S.finance.expenses.filter((e) => inW(e.date)).forEach((e) => { by[e.cat] = (by[e.cat] || 0) + e.amount; }); const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0]; return top ? { name: cat(top[0]).emoji + ' ' + cat(top[0]).name, v: top[1] } : null; })(),
    savedWait: sum(S.finance.waitlist.filter((w) => w.status === 'dropped' && w.decidedAt && inW(w.decidedAt))),
    moneyDays: ks.filter((k) => S.finance.expenses.some((e) => e.date === k)).length,
    moments: days.reduce((a, d) => a + Object.values(d.moments || {}).filter(Boolean).length, 0),
    ptasks: S.projects.reduce((a, p) => a + p.tasks.filter((t) => t.done && t.doneAt && inW(t.doneAt)).length, 0),
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
  if (st.savedWait > 0) wins.push(`${fmtEur(st.savedWait)} économisés grâce à l’attente 48 h.`);
  if (st.moneyDays >= 5) wins.push(`Dépenses notées ${st.moneyDays} jours sur 7 : tu sais où va ton argent.`);
  if (st.moments >= 5) wins.push(`${st.moments} moments rien qu’à eux avec tes enfants. C’est ce qu’ils retiendront.`);
  if (st.ptasks > 0) wins.push(`${st.ptasks} action${st.ptasks > 1 ? 's' : ''} sur tes projets perso.`);
  if (!wins.length) wins.push('Tu es là, tu ouvres ton bilan : c’est déjà repartir. Une semaine calme n’efface rien.');

  if (st.sleep != null && st.sleep < 7) tips.push(`Sommeil moyen ${round1(st.sleep)} h : vise une heure de coucher fixe cette semaine. Le manque de sommeil augmente les envies de sucre.`);
  if (st.topTrigger) tips.push(`Déclencheur n°1 : « ${st.topTrigger} ». Prépare un plan « si… alors… » précis pour ce moment-là.`);
  if (st.workouts < S.profile.sportGoal) tips.push(`Sport : place tes ${S.profile.sportGoal} séances dans « Ma semaine » dès maintenant, avec un jour et une heure.`);
  if (st.mood != null && st.mood < 3) tips.push('Humeur basse cette semaine : garde 1 minute de respiration par jour et parles-en à quelqu’un de confiance. Si ça dure, ton médecin peut t’aider.');
  if (st.chores < 5) tips.push('Ménage : juste les 10 minutes de rangement le soir, rien de plus. Le reste suivra.');
  if (mod('finance') && st.moneyDays < 3) tips.push('Argent : note tes dépenses le soir au check-in, 30 secondes suffisent.');
  if (st.snacks > 0 && st.cravings > st.surfed) tips.push(`${fmtEur(st.snacks)} de snacks et sucreries cette semaine : prévois une collation à l’avance pour le moment « ${st.topTrigger || 'difficile'} ».`);
  if (!tips.length) tips.push('Garde le même cap et ajoute une seule petite chose : par exemple 1 gratitude par jour.');

  let weight = null;
  if (st.weightStart != null && st.weightEnd != null && st.weightStart !== st.weightEnd) {
    const d = st.weightEnd - st.weightStart;
    weight = `Poids : ${round1(st.weightStart)} → ${round1(st.weightEnd)} kg (${d > 0 ? '+' : ''}${round1(d)}). Regarde la tendance sur un mois, pas au jour le jour.`;
  }
  const money = st.spent ? `Dépenses de la semaine : ${fmtEur(st.spent)}${st.topCat ? ` (surtout ${st.topCat.name} : ${fmtEur(st.topCat.v)})` : ''}.` : null;
  return { wins, tips: tips.slice(0, 3), weight, money };
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
  if (s.people === base.people) s.people[0].name = s.profile?.name || s.people[0].name;
  for (const p of s.people) if (!p.role && p.id !== 'me') p.role = p.id === 'p-maman' ? 'partner' : 'child';
  s.settings.modules ||= defaultSettings().modules;
  return s;
}

// ======================================================================
// Navigation
// ======================================================================
const isRoute = (h) => TABS.some((x) => x[0] === h) || h === 'projects';
const TABS = [
  ['today', '⚡', 'Journée'],
  ['week', '🗓️', 'Semaine'],
  ['money', '💶', 'Argent'],
  ['stats', '📈', 'Stats'],
  ['more', '🏯', 'Dojo'],
];
let route = 'today';
let statsRange = 30;
function setRoute(r) { route = r; if (location.hash !== '#' + r) history.replaceState(null, '', '#' + r); render(); window.scrollTo(0, 0); }
function renderTabs() {
  $('#tabbar').innerHTML = `<div class="tabbar"><nav>${TABS.map(([id, ic, lb]) =>
    `<a href="#${id}" class="${route === id || (id === 'today' && route === 'projects') ? 'on' : ''}" data-route="${id}"><span class="ti">${ic}</span>${lb}</a>`).join('')}</nav></div>`;
}
function render() {
  if (!S) return renderLock();
  renderTabs();
  const v = { today: viewToday, week: viewWeek, money: viewMoney, stats: viewStats, more: viewMore, projects: viewProjects }[route] || viewToday;
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
  const dueAll = S.chores.filter((c) => choreDue(c, t) || choreDoneOn(c, t));
  const due = dueAll.filter(isMine);
  const others = S.people.filter((p) => p.id !== 'me').map((p) => ({ p, list: dueAll.filter((c) => c.who === p.id) })).filter((x) => x.list.length);
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

  ${moneyTodayCard()}

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
          <div class="grow"><div class="txt">${esc(c.name)}</div><div class="sub">${esc(c.zone)} · ${c.minutes} min${(() => { const l = S.choreLog.find((x) => x.choreId === c.id && x.date === t && x.who === 'deleg'); return l ? ` · confiée à ${esc(person(l.to).name)}` : ''; })()}</div></div>
          ${done ? '' : `<button class="btn btn-sm" data-action="delegate" data-id="${c.id}" title="Déléguer">👉 Déléguer</button>`}
        </li>`; }).join('') || '<li class="muted">Rien de prévu pour toi. Repos !</li>'}
    </ul>
    ${due.length && doneCount === due.length ? '<p class="center" style="font-weight:900">✨ Ta part est faite pour aujourd’hui !</p>' : ''}
    <button class="btn btn-sm btn-ghost mt" data-action="chore-new-today">+ Tâche ponctuelle (pour moi ou à déléguer)</button>
  </section>

  ${others.length ? `
  <section class="card">
    <div class="card-head"><h2 class="c-orange">Tâches déléguées</h2><span class="meta">${others.reduce((a, o) => a + o.list.filter((c) => choreDoneOn(c, t)).length, 0)}/${others.reduce((a, o) => a + o.list.length, 0)}</span></div>
    ${others.map(({ p, list }) => `
      <div class="row" style="margin-top:6px"><b class="grow" style="font-size:17px">${esc(p.emoji)} ${esc(p.name)}</b>
        <button class="btn btn-sm btn-yellow" data-action="send-tasks" data-p="${p.id}">📤 Envoyer</button></div>
      <ul class="list">${list.map((c) => { const done = choreDoneOn(c, t); return `
        <li class="item ${done ? 'done' : ''}">
          <button class="check ${done ? 'on' : ''}" data-action="chore-toggle" data-id="${c.id}" aria-label="Fait">${done ? '✓' : ''}</button>
          <div class="grow"><div class="txt">${esc(c.name)}</div></div>
          ${done ? '' : `<button class="icon-btn" data-action="delegate" data-id="${c.id}" title="Changer de personne">🔁</button>`}
        </li>`; }).join('')}</ul>`).join('<hr class="dash">')}
    <p class="small-note">Coche quand c’est fait. « Envoyer » prépare un message (WhatsApp, SMS…) avec ses tâches du jour.</p>
  </section>` : ''}

  <section class="card">
    <div class="card-head"><h2 class="c-green">Sport</h2><span class="meta">${wCount}/${S.profile.sportGoal} cette semaine</span></div>
    <div class="prog"><i style="width:${Math.min(100, (wCount / S.profile.sportGoal) * 100)}%"></i></div>
    ${planned && !todayW.length ? `<p style="font-weight:800">Prévu aujourd’hui : ${esc(planned)}</p>` : ''}
    ${todayW.map((w) => `<div class="item"><span class="txt">✅ ${esc(w.type)} · ${w.minutes} min · intensité ${w.intensity}/5</span><button class="icon-btn" data-action="workout-del" data-id="${w.id}">✕</button></div>`).join('')}
    <button class="btn btn-green btn-block mt" data-action="workout-open">💥 J’ai fait une séance</button>
  </section>

  ${projectsTodayCard()}

  ${familyTodayCard()}

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
  ${balanceHTML(ws)}
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
        ${chores.map((c) => `<span class="tag chore" ${isMine(c) ? '' : 'style="background:#fff"'}>${choreDoneOn(c, k) ? '✓ ' : ''}${isMine(c) ? '' : esc(person(c.who).emoji) + ' '}${esc(c.name)}</span>`).join('')}
      </div>
      <div class="row wrap mt">
        ${(dd.priorities || []).length < 3 ? `<button class="btn btn-sm" data-action="plan-prio" data-k="${k}">+ priorité</button>` : ''}
        ${!w.length ? `<button class="btn btn-sm" data-action="plan-sport" data-k="${k}">${planned ? '✎ séance' : '+ séance'}</button>` : ''}
      </div>
    </section>`;
  }).join('')}`;
}

// Vue d'équilibre : qui porte quoi cette semaine (temps prévu)
function balanceHTML(ws) {
  const ks = weekKeys(ws);
  const rows = S.people.map((p) => {
    let min = 0, n = 0, done = 0;
    for (const k of ks) for (const c of S.chores) if ((c.who || 'me') === p.id && choreScheduledOn(c, k)) { n++; min += c.minutes || 0; if (choreDoneOn(c, k)) done++; }
    return { p, min, n, done };
  }).filter((r) => r.n);
  if (rows.length < 2) return '';
  const max = Math.max(...rows.map((r) => r.min), 1);
  return `<section class="card">
    <div class="card-head"><h2 class="c-cyan">Qui fait quoi</h2><span class="meta">temps prévu cette semaine</span></div>
    ${rows.map((r) => `<div class="row" style="margin:6px 0"><span style="width:96px;font-weight:800;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.p.emoji)} ${esc(r.p.name)}</span>
      <div class="prog grow"><i style="width:${(r.min / max) * 100}%;background:var(--cyan)"></i></div>
      <b style="width:76px;text-align:right;font-size:13px;white-space:nowrap">${Math.floor(r.min / 60) ? Math.floor(r.min / 60) + ' h ' : ''}${r.min % 60} min</b></div>`).join('')}
    <p class="small-note">Tâches cochées cette semaine : ${rows.map((r) => `${esc(r.p.emoji)} ${r.done}/${r.n}`).join(' · ')}</p>
  </section>`;
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
  <section class="card"><div class="card-head"><h2 class="c-green">Dépenses par semaine</h2></div>
    ${barChart(wst.map((s) => ({ label: lab(s.ws), values: [Math.round(s.spent - s.snacks), Math.round(s.snacks)] })), { colors: ['#2ee59d', '#ff3d7f'] })}
    <div class="legend"><span><i style="background:#2ee59d"></i>dépenses (€)</span><span><i style="background:#ff3d7f"></i>dont snacks et sucreries</span></div>
    <label class="lbl">Snacks et sucreries vs envies</label>
    ${wst.map((s) => `<div class="row" style="margin:3px 0;font-size:13px;font-weight:700"><span style="width:52px">${lab(s.ws)}</span><span class="grow">🍫 ${fmtEur(s.snacks)}</span><span>🌊 ${s.cravings} envie(s), ${s.cravings - s.surfed} craquage(s)</span></div>`).join('')}
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
    ${r.money ? `<p>💶 ${esc(r.money)}</p>` : ''}
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
    <div class="card-head"><h2 class="c-cyan">Tâches de la maison</h2><span class="meta">${S.chores.length} tâches</span></div>
    ${S.people.map((p) => { const list = S.chores.filter((c) => (c.who || 'me') === p.id); return list.length ? `
      <p style="font-weight:900;margin:10px 0 0">${esc(p.emoji)} ${esc(p.id === 'me' ? p.name + ' (moi)' : p.name)}</p>
      <ul class="list">${list.map((c) => `<li class="item"><div class="grow"><div class="txt">${esc(c.name)}</div><div class="sub">${esc(c.zone)} · ${freqLabel(c.freq)} · ${c.minutes} min</div></div><button class="icon-btn" data-action="chore-edit" data-id="${c.id}">✎</button><button class="icon-btn" data-action="chore-del" data-id="${c.id}">✕</button></li>`).join('')}</ul>` : ''; }).join('')}
    <div class="row wrap mt">
      <button class="btn btn-sm" data-action="chore-new">+ Nouvelle tâche</button>
      <button class="btn btn-sm btn-yellow" data-action="family-load">🏠 Charger le planning familial</button>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-green">Le foyer</h2></div>
    <p class="muted" style="margin-top:0">Les personnes à qui tu peux déléguer des tâches.</p>
    <ul class="list">${S.people.map((p) => `<li class="item"><span style="font-size:24px">${esc(p.emoji)}</span><span class="txt">${esc(p.name)}${p.id === 'me' ? ' (moi)' : ''}</span>
      <button class="icon-btn" data-action="person-edit" data-id="${p.id}">✎</button>${p.id === 'me' ? '' : `<button class="icon-btn" data-action="person-del" data-id="${p.id}">✕</button>`}</li>`).join('')}</ul>
    <button class="btn btn-sm mt" data-action="person-new">+ Ajouter une personne</button>
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
    <p style="font-weight:900;margin:0 0 6px">🧩 Modules affichés dans Ma journée</p>
    <div class="chips">${[['finance', '💶 Argent'], ['projects', '🚀 Projets perso'], ['family', '❤️ Famille']].map(([k, l]) => `<button class="chip ${mod(k) ? 'on' : ''}" data-action="module-toggle" data-m="${k}">${mod(k) ? '✓ ' : ''}${l}</button>`).join('')}</div>
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
function choreModal(ch, preset = {}) {
  const isNew = !ch;
  const c = ch ? JSON.parse(JSON.stringify(ch)) : { id: uid(), name: '', zone: 'Maison', who: 'me', freq: { type: 'weekly', days: [weekdayIdx(todayKey())] }, minutes: 10, ...preset };
  c.who ||= 'me';
  const draw = () => {
    const name = $('#cn')?.value ?? c.name, zone = $('#cz')?.value ?? c.zone, min = $('#cm')?.value ?? c.minutes, n = $('#cnn')?.value ?? c.freq.n ?? 3;
    c.name = name; c.zone = zone; c.minutes = +min || 10; if (c.freq.type === 'every') c.freq.n = Math.max(2, +n || 3);
    if (c.freq.type === 'once' && $('#cdate')) c.freq.date = $('#cdate').value || todayKey();
    openModal(`
      <h2>${isNew ? 'Nouvelle tâche' : 'Modifier la tâche'}</h2>
      <label class="lbl" for="cn">Tâche</label><input class="input" id="cn" value="${esc(c.name)}" maxlength="80" placeholder="Ex. Nettoyer les vitres">
      <label class="lbl">Qui s’en occupe ?</label>
      <div class="chips">${S.people.map((p) => `<button class="chip ${c.who === p.id ? 'on' : ''}" data-m="who" data-v="${p.id}">${esc(p.emoji)} ${esc(p.id === 'me' ? 'Moi' : p.name)}</button>`).join('')}</div>
      <label class="lbl" for="cz">Zone</label><input class="input" id="cz" value="${esc(c.zone)}" maxlength="40">
      <label class="lbl">Fréquence</label>
      <div class="chips">
        <button class="chip ${c.freq.type === 'once' ? 'on' : ''}" data-m="ft" data-v="once">Une seule fois</button>
        <button class="chip ${c.freq.type === 'daily' ? 'on' : ''}" data-m="ft" data-v="daily">Tous les jours</button>
        <button class="chip ${c.freq.type === 'weekly' ? 'on' : ''}" data-m="ft" data-v="weekly">Jours fixes</button>
        <button class="chip ${c.freq.type === 'every' ? 'on' : ''}" data-m="ft" data-v="every">Tous les X jours</button>
      </div>
      ${c.freq.type === 'weekly' ? `<div class="chips mt">${WD.map((w, i) => `<button class="chip ${(c.freq.days || []).includes(i) ? 'on' : ''}" data-m="wd" data-v="${i}">${w}</button>`).join('')}</div>
        <div class="chips mt"><button class="chip ${c.freq.alt ? 'on' : ''}" data-m="alt">${c.freq.alt ? '✓ ' : ''}1 semaine sur 2 (en commençant cette semaine)</button></div>` : ''}
      ${c.freq.type === 'once' ? `<div class="row mt"><span style="font-weight:800">Le</span><input class="input" id="cdate" type="date" value="${c.freq.date || todayKey()}"></div>` : ''}
      ${c.freq.type === 'every' ? `<div class="row mt"><span style="font-weight:800">Tous les</span><input class="input" style="width:80px" id="cnn" type="number" min="2" max="90" value="${c.freq.n || 3}"><span style="font-weight:800">jours</span></div>` : ''}
      <label class="lbl" for="cm">Durée estimée (min)</label><input class="input" id="cm" type="number" min="1" max="240" value="${c.minutes}">
      <button class="btn btn-primary btn-block mt" data-m="ok">Enregistrer</button>
      <button class="btn btn-ghost btn-block mt" data-m="cancel">Annuler</button>`);
    $('.modal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      const m = b.dataset.m;
      if (m === 'ft') {
        const v = b.dataset.v;
        c.freq = v === 'daily' ? { type: 'daily' } : v === 'weekly' ? { type: 'weekly', days: c.freq.days || [weekdayIdx(todayKey())] } : v === 'once' ? { type: 'once', date: todayKey() } : { type: 'every', n: c.freq.n || 3 };
        draw();
      } else if (m === 'who') { c.who = b.dataset.v; draw();
      } else if (m === 'alt') { c.freq.alt = !c.freq.alt; c.freq.anchor = weekStart(todayKey()); draw();
      } else if (m === 'wd') {
        const i = +b.dataset.v; const s = new Set(c.freq.days || []); s.has(i) ? s.delete(i) : s.add(i); c.freq.days = [...s].sort(); draw();
      } else if (m === 'cancel') closeModal();
      else if (m === 'ok') {
        c.name = $('#cn').value.trim(); c.zone = $('#cz').value.trim() || 'Maison'; c.minutes = +$('#cm').value || 10;
        if (c.freq.type === 'every') c.freq.n = Math.max(2, +$('#cnn').value || 3);
        if (c.freq.type === 'once') c.freq.date = $('#cdate').value || todayKey();
        if (!c.name) return toast('Donne un nom à la tâche');
        if (isNew) S.chores.push(c); else S.chores[S.chores.findIndex((x) => x.id === c.id)] = c;
        save(); closeModal(); render();
      }
    });
  };
  draw();
}
function delegateModal(ch) {
  openModal(`<h2>👉 Déléguer</h2>
    <p style="font-weight:700;margin-top:0">« ${esc(ch.name)} » : qui s’en occupe ?</p>
    <div class="chips">${S.people.map((p) => `<button class="chip ${(ch.who || 'me') === p.id ? 'on' : ''}" data-m="who" data-v="${p.id}">${esc(p.emoji)} ${esc(p.id === 'me' ? 'Moi' : p.name)}</button>`).join('')}</div>
    <label class="lbl">Pour combien de temps ?</label>
    <div class="row wrap">
      <button class="btn btn-sm btn-yellow" data-m="scope" data-v="today">Juste aujourd’hui</button>
      ${ch.freq.type === 'once' ? '' : '<button class="btn btn-sm" data-m="scope" data-v="always">À chaque fois</button>'}
    </div>
    <p class="small-note">« Juste aujourd’hui » crée une tâche ponctuelle pour cette personne ; ta tâche habituelle est cochée comme confiée.</p>
    <button class="btn btn-ghost btn-block mt" data-m="cancel">Annuler</button>`);
  let who = ch.who || 'me';
  $('.modal').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'who') { who = b.dataset.v; $('.modal').querySelectorAll('[data-m="who"]').forEach((x) => x.classList.toggle('on', x === b)); }
    else if (b.dataset.m === 'cancel') closeModal();
    else if (b.dataset.m === 'scope') {
      const t = todayKey();
      if (b.dataset.v === 'always' || ch.freq.type === 'once') ch.who = who;
      else if (who !== (ch.who || 'me')) {
        S.chores.push({ id: uid(), name: ch.name, zone: ch.zone, who, minutes: ch.minutes, freq: { type: 'once', date: t }, last: null, from: ch.id });
        S.choreLog.push({ id: uid(), choreId: ch.id, date: t, who: 'deleg', to: who });
      }
      save(); closeModal(); render();
      toast(`Confié à ${esc(person(who).emoji)} ${esc(person(who).name)}`, 'DÉLÉGUÉ !');
    }
  });
}
function tasksMessage(pid) {
  const t = todayKey();
  const p = person(pid);
  const list = S.chores.filter((c) => c.who === pid && choreDue(c, t) && !choreDoneOn(c, t));
  if (!list.length) return null;
  return `Coucou ${p.name} ! Tes missions du jour 💪\n${list.map((c) => '☐ ' + c.name).join('\n')}\nMerci pour ton aide ! 🙏`;
}
async function sendTasks(pid) {
  const msg = tasksMessage(pid);
  if (!msg) return toast('Rien à envoyer : tout est fait ✨');
  if (navigator.share) { try { await navigator.share({ text: msg }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  openModal(`<h2>📤 Envoyer à ${esc(person(pid).name)}</h2>
    <textarea class="input" rows="7" readonly>${esc(msg)}</textarea>
    <a class="btn btn-green btn-block mt" style="text-align:center;text-decoration:none" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="btn btn-block mt" style="text-align:center;text-decoration:none" href="sms:?&body=${encodeURIComponent(msg)}">SMS</a>
    <button class="btn btn-yellow btn-block mt" data-action="copy-msg">Copier le texte</button>
    <button class="btn btn-ghost btn-block mt" data-action="modal-close">Fermer</button>`);
}
function personModal(p) {
  const isNew = !p;
  const emojis = ['👨', '👩', '🧑', '👧', '👦', '👶', '👵', '👴', '🧔', '👱‍♀️', '🧕', '🐶'];
  let emoji = p?.emoji || '🧑';
  let role = p?.role || 'child';
  const draw = () => {
    const nm = $('#pn')?.value ?? p?.name ?? '';
    openModal(`<h2>${isNew ? 'Ajouter une personne' : 'Modifier'}</h2>
      <label class="lbl" for="pn">Prénom</label><input class="input" id="pn" maxlength="24" value="${esc(nm)}">
      <label class="lbl">Avatar</label>
      <div class="chips">${emojis.map((x) => `<button class="chip ${emoji === x ? 'on' : ''}" data-m="em" data-v="${x}" style="font-size:20px">${x}</button>`).join('')}</div>
      ${p?.id === 'me' ? '' : `<label class="lbl">Rôle</label><div class="chips">${[['partner', 'Conjoint(e)'], ['child', 'Enfant'], ['other', 'Autre']].map(([k, l]) => `<button class="chip ${role === k ? 'on' : ''}" data-m="role" data-v="${k}">${l}</button>`).join('')}</div>`}
      <button class="btn btn-primary btn-block mt" data-m="ok">Enregistrer</button>
      <button class="btn btn-ghost btn-block mt" data-m="cancel">Annuler</button>`);
    $('.modal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      if (b.dataset.m === 'em') { emoji = b.dataset.v; draw(); }
      else if (b.dataset.m === 'role') { role = b.dataset.v; draw(); }
      else if (b.dataset.m === 'cancel') closeModal();
      else if (b.dataset.m === 'ok') {
        const name = $('#pn').value.trim(); if (!name) return toast('Donne un prénom');
        if (isNew) S.people.push({ id: 'p-' + uid(), name, emoji, role });
        else { p.name = name; p.emoji = emoji; if (p.id === 'me') S.profile.name = name; else p.role = role; }
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
// V2 : Argent (dépenses quotidiennes), projets perso, famille
// ======================================================================
const fmtEur = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const monthOf = (k) => k.slice(0, 7);
const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthLabel = (m) => new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const daysInMonth = (m) => new Date(+m.slice(0, 4), +m.slice(5), 0).getDate();
const parseAmount = (v) => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };

function defaultCategories() {
  const c = (id, emoji, name) => ({ id, emoji, name, budget: null });
  return [
    c('courses', '🛒', 'Courses alimentaires'),
    c('snacks', '🍫', 'Snacks et sucreries'),
    c('resto', '🍔', 'Restaurant et à emporter'),
    c('transport', '⛽', 'Carburant et transport'),
    c('maison', '🏠', 'Maison'),
    c('enfants', '🧸', 'Enfants'),
    c('sante', '💊', 'Santé'),
    c('loisirs', '🎉', 'Loisirs et sorties'),
    c('abos', '📱', 'Abonnements'),
    c('cadeaux', '🎁', 'Cadeaux'),
    c('autre', '📦', 'Autre'),
  ];
}
function defaultFinance() {
  return { categories: defaultCategories(), expenses: [], recurring: [], pendingRec: [], waitlist: [], savings: { goal: null, current: 0 } };
}
function defaultSettings() { return { modules: { finance: true, projects: true, family: true } }; }
const mod = (m) => S.settings?.modules?.[m] !== false;
const cat = (id) => S.finance.categories.find((c) => c.id === id) || { id, emoji: '📦', name: 'Autre' };
const expIn = (from, to) => S.finance.expenses.filter((e) => e.date >= from && e.date <= to);
const sum = (arr) => arr.reduce((a, e) => a + (e.amount || 0), 0);
const monthExp = (m) => S.finance.expenses.filter((e) => monthOf(e.date) === m);

// Dépenses fixes : à confirmer quand leur jour du mois arrive
function refreshRecurring() {
  const t = todayKey(), m = monthOf(t), d = +t.slice(8);
  let changed = false;
  for (const r of S.finance.recurring) {
    if (r.active === false || r.lastMonth === m) continue;
    if (Math.min(r.day, daysInMonth(m)) > d) continue;
    if (!S.finance.pendingRec.some((p) => p.recId === r.id && p.month === m)) { S.finance.pendingRec.push({ id: uid(), recId: r.id, month: m }); changed = true; }
  }
  if (changed) save();
}
function pendingRecHTML() {
  const list = S.finance.pendingRec.map((p) => ({ p, r: S.finance.recurring.find((x) => x.id === p.recId) })).filter((x) => x.r);
  if (!list.length) return '';
  return `<div class="plan-box" style="background:#e5f4e4">
    <b>Dépenses fixes à confirmer</b>
    ${list.map(({ p, r }) => `<div class="row" style="margin-top:6px"><span class="grow">${esc(cat(r.cat).emoji)} ${esc(r.name)} · ${fmtEur(r.amount)}</span>
      <button class="btn btn-sm btn-green" data-action="rec-confirm" data-id="${p.id}">✓</button>
      <button class="btn btn-sm" data-action="rec-skip" data-id="${p.id}">Pas ce mois</button></div>`).join('')}
  </div>`;
}

// Carte « Argent » sur Ma journée
function moneyTodayCard() {
  if (!mod('finance')) return '';
  const t = todayKey();
  const today = expIn(t, t);
  return `<section class="card">
    <div class="card-head"><h2 class="c-green">Dépenses du jour</h2><span class="meta">${fmtEur(sum(today))}</span></div>
    ${pendingRecHTML()}
    ${today.length ? `<ul class="list">${today.slice(-4).reverse().map((e) => `<li class="item"><span class="txt">${esc(cat(e.cat).emoji)} ${esc(e.note || cat(e.cat).name)}</span><b>${fmtEur(e.amount)}</b></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Rien de noté aujourd’hui.</p>'}
    <button class="btn btn-green btn-block mt" data-action="exp-new">💶 + Dépense</button>
  </section>`;
}

// Écran « Argent »
let moneyMonth = null;
function viewMoney() {
  const t = todayKey();
  const m = moneyMonth || monthOf(t);
  const ws = weekStart(t);
  const prevM = addMonths(m, -1);
  const mExp = monthExp(m), pExp = monthExp(prevM);
  const mTot = sum(mExp), pTot = sum(pExp);
  const isCur = m === monthOf(t);
  const dayN = isCur ? +t.slice(8) : daysInMonth(m);
  // même période le mois dernier pour comparer à date
  const pSame = sum(pExp.filter((e) => +e.date.slice(8) <= dayN));
  const byCat = S.finance.categories.map((c) => ({ c, v: sum(mExp.filter((e) => e.cat === c.id)) })).filter((x) => x.v > 0 || x.c.budget).sort((a, b) => b.v - a.v);
  const maxCat = Math.max(1, ...byCat.map((x) => x.v));
  const todayList = expIn(t, t);
  const recent = [...S.finance.expenses].filter((e) => monthOf(e.date) === m).sort((a, b) => (a.date === b.date ? b.ts - a.ts : a.date < b.date ? 1 : -1)).slice(0, 30);
  const waiting = S.finance.waitlist.filter((w) => w.status === 'waiting');
  const saved = sum(S.finance.waitlist.filter((w) => w.status === 'dropped'));
  const sv = S.finance.savings;
  const avg3 = (() => { const ms = [1, 2, 3].map((i) => sum(monthExp(addMonths(monthOf(t), -i)))).filter((x) => x > 0); return ms.length ? avg(ms) : null; })();
  return `
  <h1 class="page-title">Mon argent</h1>
  <section class="card">
    <div class="card-head"><h2 class="c-yellow">En bref</h2></div>
    <div class="kpis">
      <div class="kpi"><b>${fmtEur(sum(todayList))}</b><span>aujourd’hui</span></div>
      <div class="kpi"><b>${fmtEur(sum(expIn(ws, addDays(ws, 6))))}</b><span>cette semaine</span></div>
      <div class="kpi"><b>${fmtEur(sum(monthExp(monthOf(t))))}</b><span>ce mois-ci</span></div>
      <div class="kpi"><b>${fmtEur(saved)}</b><span>économisés (attente 48 h)</span></div>
    </div>
    ${pendingRecHTML()}
    <button class="btn btn-green btn-big btn-block mt" data-action="exp-new">+ DÉPENSE</button>
  </section>

  <section class="card">
    <div class="card-head">
      <button class="btn btn-sm" data-action="money-month" data-v="-1" aria-label="Mois précédent">◀</button>
      <h2 class="c-cyan" style="text-transform:capitalize">${esc(monthLabel(m))}</h2>
      <button class="btn btn-sm" data-action="money-month" data-v="1" ${isCur ? 'disabled style="opacity:.3"' : ''} aria-label="Mois suivant">▶</button>
    </div>
    <div class="kpis">
      <div class="kpi"><b>${fmtEur(mTot)}</b><span>dépensé${isCur ? ' à ce jour' : ''}</span></div>
      <div class="kpi"><b>${pSame ? ((mTot - pSame) >= 0 ? '+' : '') + Math.round(((mTot - pSame) / pSame) * 100) + ' %' : '–'}</b><span>vs ${esc(new Date(+prevM.slice(0, 4), +prevM.slice(5) - 1, 1).toLocaleDateString('fr-FR', { month: 'long' }))} à date (${fmtEur(pSame)})</span></div>
    </div>
    <label class="lbl">Par catégorie${S.finance.categories.some((c) => c.budget) ? ' et budget' : ''}</label>
    ${byCat.length ? byCat.map(({ c, v }) => {
      const b = c.budget; const pct = b ? v / b : v / maxCat;
      const color = b ? (pct >= 1 ? '#ff3d7f' : pct >= 0.8 ? '#ff9f1c' : '#2ee59d') : '#00c2ff';
      return `<div style="margin:8px 0"><div class="row"><span class="grow" style="font-weight:800;font-size:14px">${esc(c.emoji)} ${esc(c.name)}</span><b style="font-size:14px">${fmtEur(v)}${b ? ` <span class="muted">/ ${fmtEur(b)}</span>` : ''}</b></div>
        <div class="prog" style="margin-top:4px"><i style="width:${Math.min(100, pct * 100)}%;background:${color}"></i></div></div>`;
    }).join('') : '<p class="muted">Aucune dépense ce mois-ci.</p>'}
    <button class="btn btn-sm mt" data-action="cats-edit">✎ Catégories et budgets</button>
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-pink">Dépenses</h2><span class="meta">${mExp.length} ce mois</span></div>
    ${recent.length ? `<ul class="list">${recent.map((e) => `<li class="item"><div class="grow"><div class="txt">${esc(cat(e.cat).emoji)} ${esc(e.note || cat(e.cat).name)}</div><div class="sub">${fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' })}${e.pay ? ' · ' + esc(e.pay) : ''}${e.recId ? ' · fixe' : ''}</div></div><b>${fmtEur(e.amount)}</b><button class="icon-btn" data-action="exp-edit" data-id="${e.id}">✎</button></li>`).join('')}</ul>` : '<p class="muted">Rien pour ce mois.</p>'}
    ${mExp.length > 30 ? '<p class="small-note">Les 30 dernières sont affichées. Toutes sont dans l’export.</p>' : ''}
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-orange">En attente 48 h</h2><span class="meta">anti-achat impulsif</span></div>
    <p class="muted" style="margin-top:0">Un achat pas prévu ? Mets-le ici. Dans 48 h, tu décides à froid.</p>
    ${waiting.length ? `<ul class="list">${waiting.map((w) => { const left = w.created + 48 * 3600000 - Date.now(); return `<li class="item"><div class="grow"><div class="txt">${esc(w.name)}</div><div class="sub">${fmtEur(w.amount)} · ${left > 0 ? `encore ${Math.floor(left / 3600000)} h ${pad(Math.floor((left % 3600000) / 60000))}` : 'tu peux décider'}</div></div>
      ${left > 0 ? `<button class="icon-btn" data-action="wait-drop" data-id="${w.id}" title="Abandonner">✕</button>` : `<button class="btn btn-sm" data-action="wait-buy" data-id="${w.id}">J’achète</button><button class="btn btn-sm btn-green" data-action="wait-drop" data-id="${w.id}">J’abandonne</button>`}</li>`; }).join('')}</ul>` : ''}
    <button class="btn btn-sm mt" data-action="wait-new">+ Mettre un achat en attente</button>
    ${saved ? `<p class="small-note">Déjà ${fmtEur(saved)} économisés grâce aux 48 h 💪</p>` : ''}
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-violet">Épargne de précaution</h2></div>
    ${sv.goal ? `<div class="row"><b class="grow">${fmtEur(sv.current)} / ${fmtEur(sv.goal)}</b><span class="muted">${Math.round((sv.current / sv.goal) * 100)} %</span></div>
      <div class="prog mt"><i style="width:${Math.min(100, (sv.current / sv.goal) * 100)}%;background:var(--violet)"></i></div>` : '<p class="muted" style="margin-top:0">Un matelas pour les imprévus. Objectif conseillé : 3 mois de dépenses.</p>'}
    ${avg3 ? `<p class="small-note">Tes dépenses moyennes : ${fmtEur(avg3)} par mois, donc 3 mois ≈ ${fmtEur(avg3 * 3)}.</p>` : ''}
    <div class="row wrap mt"><button class="btn btn-sm" data-action="sav-edit">${sv.goal ? '✎ Objectif / montant' : 'Fixer un objectif'}</button>${sv.goal ? '<button class="btn btn-sm btn-violet" data-action="sav-add">+ J’ai mis de côté</button>' : ''}</div>
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-green">Dépenses fixes</h2><span class="meta">${fmtEur(sum(S.finance.recurring.filter((r) => r.active !== false)))}/mois</span></div>
    <p class="muted" style="margin-top:0">Loyer, assurances, abonnements… Proposées chaque mois à leur date, tu confirmes d’un geste.</p>
    <ul class="list">${S.finance.recurring.map((r) => `<li class="item"><div class="grow"><div class="txt">${esc(cat(r.cat).emoji)} ${esc(r.name)}</div><div class="sub">le ${r.day} du mois · ${fmtEur(r.amount)}</div></div><button class="icon-btn" data-action="rec-edit" data-id="${r.id}">✎</button><button class="icon-btn" data-action="rec-del" data-id="${r.id}">✕</button></li>`).join('')}</ul>
    <button class="btn btn-sm mt" data-action="rec-new">+ Dépense fixe</button>
  </section>

  <section class="card">
    <div class="card-head"><h2 class="c-cyan">Export</h2></div>
    <p class="muted" style="margin-top:0">Toutes tes dépenses dans un tableau (CSV) pour Excel ou Google Sheets.</p>
    <button class="btn btn-sm btn-yellow" data-action="exp-csv">Exporter en CSV</button>
  </section>`;
}

function expenseModal(e) {
  const isNew = !e;
  const x = e ? { ...e } : { id: uid(), date: todayKey(), amount: null, cat: null, note: '', pay: '', ts: Date.now() };
  const pays = ['Carte', 'Espèces', 'Virement'];
  const draw = () => {
    const amt = $('#ea')?.value ?? (x.amount != null ? String(x.amount).replace('.', ',') : '');
    const note = $('#en')?.value ?? x.note; const date = $('#ed')?.value ?? x.date;
    x.note = note; x.date = date;
    openModal(`<h2>${isNew ? '💶 Nouvelle dépense' : 'Modifier la dépense'}</h2>
      <input class="input" id="ea" inputmode="decimal" placeholder="0,00 €" value="${esc(amt)}" style="font-size:32px;font-family:var(--title);letter-spacing:1px;text-align:center">
      <label class="lbl">Catégorie</label>
      <div class="chips">${S.finance.categories.map((c) => `<button class="chip ${x.cat === c.id ? 'on' : ''}" data-m="cat" data-v="${c.id}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('')}</div>
      <label class="lbl" for="en">Note (facultatif)</label>
      <input class="input" id="en" maxlength="80" placeholder="Ex. pain + lait" value="${esc(x.note)}">
      <div class="row mt"><div class="grow"><label class="lbl" for="ed" style="margin-top:0">Date</label><input class="input" id="ed" type="date" value="${x.date}"></div></div>
      <label class="lbl">Paiement (facultatif)</label>
      <div class="chips">${pays.map((p) => `<button class="chip ${x.pay === p ? 'on' : ''}" data-m="pay" data-v="${p}">${p}</button>`).join('')}</div>
      <button class="btn btn-green btn-big btn-block mt" data-m="ok">Enregistrer</button>
      ${isNew ? '' : '<button class="btn btn-block mt" data-m="del" style="color:#d00045">Supprimer</button>'}
      <button class="btn btn-ghost btn-block mt" data-m="cancel">Annuler</button>`);
    if (isNew && !amt) setTimeout(() => $('#ea')?.focus(), 60);
    $('.modal').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-m]'); if (!b) return;
      const m = b.dataset.m;
      if (m === 'cat') { x.cat = b.dataset.v; draw(); }
      else if (m === 'pay') { x.pay = x.pay === b.dataset.v ? '' : b.dataset.v; draw(); }
      else if (m === 'cancel') closeModal();
      else if (m === 'del') { S.finance.expenses = S.finance.expenses.filter((y) => y.id !== x.id); save(); closeModal(); render(); }
      else if (m === 'ok') {
        const a = parseAmount($('#ea').value);
        if (!a) return toast('Indique un montant');
        if (!x.cat) return toast('Choisis une catégorie');
        x.amount = a; x.note = $('#en').value.trim(); x.date = $('#ed').value || todayKey();
        if (isNew) {
          const first = !S.finance.expenses.some((y) => y.date === x.date);
          S.finance.expenses.push(x); closeModal();
          award(first ? 5 : 2, 'CHING !', `${fmtEur(a)} noté`);
          budgetWarn(x.cat, monthOf(x.date));
        } else { S.finance.expenses[S.finance.expenses.findIndex((y) => y.id === x.id)] = x; save(); closeModal(); }
        render();
      }
    });
  };
  draw();
}
function budgetWarn(cid, m) {
  const c = cat(cid); if (!c.budget) return;
  const v = sum(monthExp(m).filter((e) => e.cat === cid));
  const pct = v / c.budget;
  if (pct >= 1) setTimeout(() => toast(`${esc(c.emoji)} ${esc(c.name)} : budget du mois atteint (${fmtEur(v)}). Pas de panique, on ajuste.`), 1400);
  else if (pct >= 0.8) setTimeout(() => toast(`${esc(c.emoji)} ${esc(c.name)} : ${Math.round(pct * 100)} % du budget du mois.`), 1400);
}
function catsModal() {
  openModal(`<h2>Catégories et budgets</h2>
    <p class="muted" style="margin-top:0">Budget mensuel facultatif : laisse vide pour ne pas en avoir.</p>
    <form id="cf">${S.finance.categories.map((c) => `<div class="row" style="margin:6px 0">
      <input class="input" style="width:58px;text-align:center;padding:8px 4px" name="e-${c.id}" value="${esc(c.emoji)}" maxlength="4">
      <input class="input grow" name="n-${c.id}" value="${esc(c.name)}" maxlength="30">
      <input class="input" style="width:92px" name="b-${c.id}" inputmode="decimal" placeholder="budget €" value="${c.budget ?? ''}">
    </div>`).join('')}
    <button class="btn btn-sm mt" type="button" data-m="add">+ Catégorie</button>
    <button class="btn btn-primary btn-block mt" type="submit">Enregistrer</button>
    <button class="btn btn-ghost btn-block mt" type="button" data-action="modal-close">Annuler</button></form>`);
  $('#cf').addEventListener('click', (e) => {
    if (e.target.closest('[data-m="add"]')) { saveCats(); S.finance.categories.push({ id: 'c-' + uid(), emoji: '🏷️', name: 'Nouvelle', budget: null }); catsModal(); }
  });
  const saveCats = () => {
    const f = $('#cf');
    for (const c of S.finance.categories) {
      c.emoji = f.elements['e-' + c.id].value.trim() || c.emoji;
      c.name = f.elements['n-' + c.id].value.trim() || c.name;
      c.budget = parseAmount(f.elements['b-' + c.id].value);
    }
  };
  $('#cf').addEventListener('submit', (e) => { e.preventDefault(); saveCats(); save(); closeModal(); render(); toast('Catégories enregistrées', 'OK !'); });
}
function recModal(r) {
  const isNew = !r;
  const x = r ? { ...r } : { id: uid(), name: '', amount: null, cat: 'maison', day: 1, active: true, lastMonth: null };
  const draw = () => {
    x.name = $('#rn')?.value ?? x.name;
    openModal(`<h2>${isNew ? 'Nouvelle dépense fixe' : 'Modifier'}</h2>
      <label class="lbl" for="rn">Nom</label><input class="input" id="rn" maxlength="40" placeholder="Ex. Loyer" value="${esc(x.name)}">
      <div class="row"><div class="grow"><label class="lbl" for="ra">Montant</label><input class="input" id="ra" inputmode="decimal" value="${x.amount != null ? String(x.amount).replace('.', ',') : ''}"></div>
      <div style="width:110px"><label class="lbl" for="rd">Jour du mois</label><input class="input" id="rd" type="number" min="1" max="31" value="${x.day}"></div></div>
      <label class="lbl">Catégorie</label>
      <div class="chips">${S.finance.categories.map((c) => `<button class="chip ${x.cat === c.id ? 'on' : ''}" data-m="cat" data-v="${c.id}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('')}</div>
      <button class="btn btn-primary btn-block mt" data-m="ok">Enregistrer</button>
      <button class="btn btn-ghost btn-block mt" data-m="cancel">Annuler</button>`);
    $('.modal').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-m]'); if (!b) return;
      if (b.dataset.m === 'cat') { x.amount = parseAmount($('#ra').value) ?? x.amount; x.day = +$('#rd').value || x.day; x.cat = b.dataset.v; draw(); }
      else if (b.dataset.m === 'cancel') closeModal();
      else if (b.dataset.m === 'ok') {
        x.name = $('#rn').value.trim(); x.amount = parseAmount($('#ra').value); x.day = clamp(+$('#rd').value || 1, 1, 31);
        if (!x.name || !x.amount) return toast('Nom et montant obligatoires');
        if (isNew) S.finance.recurring.push(x); else S.finance.recurring[S.finance.recurring.findIndex((y) => y.id === x.id)] = x;
        refreshRecurring(); save(); closeModal(); render();
      }
    });
  };
  draw();
}
function exportCSV() {
  const rows = [['Date', 'Montant', 'Catégorie', 'Note', 'Paiement', 'Fixe']];
  for (const e of [...S.finance.expenses].sort((a, b) => (a.date < b.date ? -1 : 1))) rows.push([e.date, String(e.amount).replace('.', ','), cat(e.cat).name, e.note || '', e.pay || '', e.recId ? 'oui' : '']);
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `mon-dojo-depenses-${todayKey()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Export téléchargé', 'OK !');
}

// ---------- Projets perso ----------
function projectsTodayCard() {
  if (!mod('projects')) return '';
  const active = S.projects.filter((p) => !p.archived);
  const next = active.map((p) => ({ p, t: p.tasks.find((x) => !x.done) })).filter((x) => x.t).slice(0, 3);
  const doneToday = active.reduce((a, p) => a + p.tasks.filter((x) => x.done && x.doneAt === todayKey()).length, 0);
  return `<section class="card">
    <div class="card-head"><h2 class="c-violet">Projets perso</h2><span class="meta">${doneToday ? doneToday + ' action(s) aujourd’hui' : 'prochaine action'}</span></div>
    ${next.length ? `<ul class="list">${next.map(({ p, t }) => `<li class="item"><button class="check" data-action="ptask-toggle" data-p="${p.id}" data-t="${t.id}" aria-label="Fait"></button><div class="grow"><div class="txt">${esc(t.t)}</div><div class="sub">${esc(p.emoji)} ${esc(p.name)}</div></div></li>`).join('')}</ul>`
      : `<p class="muted" style="margin:0">${active.length ? 'Toutes les actions sont faites. Ajoute la suivante !' : 'Un projet qui te tient à cœur ? Découpe-le en petites actions.'}</p>`}
    <button class="btn btn-sm mt" data-route="projects">${active.length ? 'Voir mes projets' : '+ Créer un projet'}</button>
  </section>`;
}
function viewProjects() {
  const active = S.projects.filter((p) => !p.archived), arch = S.projects.filter((p) => p.archived);
  return `<h1 class="page-title">Projets perso</h1>
  <p style="color:#fff;font-weight:700;margin:-6px 4px 14px">Une action = 15 à 60 minutes, avec un verbe : « appeler », « écrire », « comparer ». La première non faite s’affiche dans Ma journée.</p>
  ${active.map((p) => { const done = p.tasks.filter((t) => t.done).length; return `<section class="card">
    <div class="card-head"><h2 class="c-violet">${esc(p.emoji)} ${esc(p.name)}</h2><span class="meta">${done}/${p.tasks.length}</span></div>
    ${p.why ? `<p class="muted" style="margin-top:0">🎯 ${esc(p.why)}</p>` : ''}
    <div class="prog"><i style="width:${p.tasks.length ? (done / p.tasks.length) * 100 : 0}%;background:var(--violet)"></i></div>
    <ul class="list mt">${p.tasks.map((t, i) => `<li class="item ${t.done ? 'done' : ''}"><button class="check ${t.done ? 'on' : ''}" data-action="ptask-toggle" data-p="${p.id}" data-t="${t.id}">${t.done ? '✓' : ''}</button><span class="txt">${esc(t.t)}</span>
      ${!t.done && i > 0 ? `<button class="icon-btn" data-action="ptask-up" data-p="${p.id}" data-t="${t.id}" title="Monter">⬆️</button>` : ''}<button class="icon-btn" data-action="ptask-del" data-p="${p.id}" data-t="${t.id}">✕</button></li>`).join('')}</ul>
    <form class="row mt" data-form="ptask-add" data-p="${p.id}"><input class="prio-input" name="t" placeholder="Nouvelle action…" maxlength="120" autocomplete="off"><button class="btn btn-sm btn-yellow" type="submit">Ajouter</button></form>
    <div class="row wrap mt"><button class="btn btn-sm" data-action="proj-edit" data-p="${p.id}">✎ Modifier</button><button class="btn btn-sm" data-action="proj-archive" data-p="${p.id}">${done === p.tasks.length && p.tasks.length ? '🏁 Terminé !' : '📦 Archiver'}</button></div>
  </section>`; }).join('')}
  <button class="btn btn-primary btn-block" data-action="proj-new" style="margin-bottom:16px">+ Nouveau projet</button>
  ${arch.length ? `<section class="card"><div class="card-head"><h2 class="c-cyan">Archivés</h2></div><ul class="list">${arch.map((p) => `<li class="item"><span class="txt">${esc(p.emoji)} ${esc(p.name)}</span><button class="btn btn-sm" data-action="proj-unarchive" data-p="${p.id}">Réactiver</button><button class="icon-btn" data-action="proj-del" data-p="${p.id}">✕</button></li>`).join('')}</ul></section>` : ''}
  <button class="btn btn-ghost btn-block" style="color:#fff;border-color:#fff" data-route="today">← Retour à ma journée</button>`;
}
function projectModal(p) {
  const isNew = !p;
  const emojis = ['🚀', '💼', '📚', '🛠️', '💡', '🎸', '🏡', '💰', '✍️', '🌱', '🧠', '🎯'];
  let emoji = p?.emoji || '🚀';
  const draw = () => {
    const nm = $('#prn')?.value ?? p?.name ?? '', why = $('#prw')?.value ?? p?.why ?? '';
    openModal(`<h2>${isNew ? 'Nouveau projet' : 'Modifier le projet'}</h2>
      <label class="lbl" for="prn">Nom</label><input class="input" id="prn" maxlength="50" placeholder="Ex. Refaire mon CV" value="${esc(nm)}">
      <label class="lbl" for="prw">Pourquoi c’est important pour moi (facultatif)</label><input class="input" id="prw" maxlength="120" value="${esc(why)}">
      <label class="lbl">Icône</label>
      <div class="chips">${emojis.map((x) => `<button class="chip ${emoji === x ? 'on' : ''}" data-m="em" data-v="${x}" style="font-size:20px">${x}</button>`).join('')}</div>
      ${isNew ? '<label class="lbl" for="prt">Première action</label><input class="input" id="prt" maxlength="120" placeholder="Ex. Lister mes expériences">' : ''}
      <button class="btn btn-primary btn-block mt" data-m="ok">Enregistrer</button>
      <button class="btn btn-ghost btn-block mt" data-m="cancel">Annuler</button>`);
    $('.modal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      if (b.dataset.m === 'em') { emoji = b.dataset.v; draw(); }
      else if (b.dataset.m === 'cancel') closeModal();
      else if (b.dataset.m === 'ok') {
        const name = $('#prn').value.trim(); if (!name) return toast('Donne un nom au projet');
        const why2 = $('#prw').value.trim();
        if (isNew) { const first = $('#prt').value.trim(); S.projects.push({ id: uid(), name, why: why2, emoji, tasks: first ? [{ id: uid(), t: first, done: false }] : [], archived: false, created: todayKey() }); }
        else { p.name = name; p.why = why2; p.emoji = emoji; }
        save(); closeModal(); render();
      }
    });
  };
  draw();
}

// ---------- Famille ----------
function familyTodayCard() {
  if (!mod('family')) return '';
  const t = todayKey(), d = day(t), ws = weekStart(t), m = monthOf(t);
  d.moments ||= {};
  const kids = S.people.filter((p) => p.id !== 'me' && p.role === 'child');
  const partner = S.people.find((p) => p.role === 'partner');
  const coupleDone = !!S.family.couple[ws];
  const dateDone = !!S.family.dates[m];
  return `<section class="card">
    <div class="card-head"><h2 class="c-pink">Famille</h2><span class="meta">les liens d’abord</span></div>
    ${kids.length ? `<label class="lbl" style="margin-top:0">15 min rien qu’à lui ou elle, aujourd’hui</label>
    <ul class="list">${kids.map((k) => `<li class="item ${d.moments[k.id] ? 'done' : ''}"><button class="check ${d.moments[k.id] ? 'on' : ''}" data-action="moment" data-p="${k.id}">${d.moments[k.id] ? '✓' : ''}</button><span class="txt">${esc(k.emoji)} ${esc(k.name)}</span></li>`).join('')}</ul>` : ''}
    ${partner ? `<label class="lbl">Couple ${esc(partner.emoji)}</label>
    <ul class="list">
      <li class="item ${coupleDone ? 'done' : ''}"><button class="check ${coupleDone ? 'on' : ''}" data-action="couple-week">${coupleDone ? '✓' : ''}</button><div class="grow"><div class="txt">Point couple de la semaine (30 min)</div><div class="sub">organisation · enfants · un merci · un besoin</div></div></li>
      <li class="item ${dateDone ? 'done' : ''}"><button class="check ${dateDone ? 'on' : ''}" data-action="couple-date">${dateDone ? '✓' : ''}</button><span class="txt">Une sortie à deux ce mois-ci</span></li>
    </ul>` : ''}
    ${!kids.length && !partner ? '<p class="muted">Ajoute les membres du foyer dans Dojo → Le foyer.</p>' : ''}
  </section>`;
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
      if (choreDoneOn(ch, t)) { S.choreLog = S.choreLog.filter((l) => !(l.choreId === ch.id && l.date === t)); S.xp = Math.max(0, S.xp - (isMine(ch) ? 10 : 3)); save(); }
      else if (!isMine(ch)) { S.choreLog.push({ id: uid(), choreId: ch.id, date: t, who: ch.who }); award(3, 'TEAM !', `${person(ch.who).name} a fait sa part`); }
      else { S.choreLog.push({ id: uid(), choreId: ch.id, date: t, who: 'me' }); ch.last = t; award(10, ['PAF !', 'ZIP !', 'SHLAK !', 'POW !'][S.choreLog.length % 4], ch.name); }
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
    // --- Argent
    case 'exp-new': expenseModal(null); break;
    case 'exp-edit': expenseModal(S.finance.expenses.find((x) => x.id === a.dataset.id)); break;
    case 'exp-csv': exportCSV(); break;
    case 'cats-edit': catsModal(); break;
    case 'money-month': { const cur = monthOf(t); const nm = addMonths(moneyMonth || cur, +a.dataset.v); if (nm <= cur) { moneyMonth = nm === cur ? null : nm; render(); } break; }
    case 'rec-new': recModal(null); break;
    case 'rec-edit': recModal(S.finance.recurring.find((r) => r.id === a.dataset.id)); break;
    case 'rec-del': S.finance.recurring = S.finance.recurring.filter((r) => r.id !== a.dataset.id); S.finance.pendingRec = S.finance.pendingRec.filter((x) => x.recId !== a.dataset.id); save(); render(); break;
    case 'rec-confirm': case 'rec-skip': {
      const pr = S.finance.pendingRec.find((x) => x.id === a.dataset.id); if (!pr) break;
      const r = S.finance.recurring.find((x) => x.id === pr.recId);
      if (r) {
        r.lastMonth = pr.month;
        if (act === 'rec-confirm') S.finance.expenses.push({ id: uid(), date: `${pr.month}-${pad(Math.min(r.day, daysInMonth(pr.month)))}`, amount: r.amount, cat: r.cat, note: r.name, pay: '', recId: r.id, ts: Date.now() });
      }
      S.finance.pendingRec = S.finance.pendingRec.filter((x) => x !== pr); save(); render();
      if (act === 'rec-confirm') toast(`${esc(r.name)} : ${fmtEur(r.amount)} enregistré`);
      break;
    }
    case 'wait-new':
      openModal(`<h2>⏳ En attente 48 h</h2><form id="wf">
        <label class="lbl" for="wn2">Quoi ?</label><input class="input" id="wn2" maxlength="60" placeholder="Ex. nouvelles baskets" required>
        <label class="lbl" for="wa">Prix</label><input class="input" id="wa" inputmode="decimal" placeholder="€" required>
        <label class="lbl">Catégorie</label><div class="chips">${S.finance.categories.map((c, i) => `<label class="chip"><input type="radio" name="wc" value="${c.id}" ${i === S.finance.categories.length - 1 ? 'checked' : ''} style="margin-right:4px">${esc(c.emoji)} ${esc(c.name)}</label>`).join('')}</div>
        <button class="btn btn-primary btn-block mt" type="submit">Lancer les 48 h</button>
        <button class="btn btn-ghost btn-block mt" type="button" data-action="modal-close">Annuler</button></form>`);
      $('#wf').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const amount = parseAmount($('#wa').value); const name = $('#wn2').value.trim();
        if (!amount || !name) return toast('Nom et prix obligatoires');
        S.finance.waitlist.push({ id: uid(), name, amount, cat: ($('#wf').elements.wc.value) || 'autre', created: Date.now(), status: 'waiting' });
        save(); closeModal(); render(); toast('On en reparle dans 48 h', 'PAUSE !');
      });
      break;
    case 'wait-buy': {
      const w = S.finance.waitlist.find((x) => x.id === a.dataset.id); w.status = 'bought'; w.decidedAt = t;
      S.finance.expenses.push({ id: uid(), date: t, amount: w.amount, cat: w.cat, note: w.name, pay: '', ts: Date.now() });
      save(); render(); toast('Achat réfléchi, achat assumé 👍'); break;
    }
    case 'wait-drop': {
      const w = S.finance.waitlist.find((x) => x.id === a.dataset.id); w.status = 'dropped'; w.decidedAt = t;
      award(15, 'ÉCONOMIE !', `${fmtEur(w.amount)} gardés`); render(); break;
    }
    case 'sav-edit':
      openModal(`<h2>Épargne de précaution</h2><form id="sf">
        <label class="lbl" for="sg2">Objectif</label><input class="input" id="sg2" inputmode="decimal" value="${S.finance.savings.goal ?? ''}">
        <label class="lbl" for="sc">Montant déjà de côté</label><input class="input" id="sc" inputmode="decimal" value="${S.finance.savings.current || ''}">
        <button class="btn btn-primary btn-block mt" type="submit">Enregistrer</button>
        <button class="btn btn-ghost btn-block mt" type="button" data-action="modal-close">Annuler</button></form>`);
      $('#sf').addEventListener('submit', (ev) => { ev.preventDefault(); S.finance.savings.goal = parseAmount($('#sg2').value); S.finance.savings.current = parseAmount($('#sc').value) || 0; save(); closeModal(); render(); });
      break;
    case 'sav-add':
      promptModal('J’ai mis de côté', 'Montant (€)', { type: 'text' }, (v) => { const n = parseAmount(v); if (n) { S.finance.savings.current = Math.round((S.finance.savings.current + n) * 100) / 100; award(10, 'BANCO !', `${fmtEur(n)} de côté`); } render(); });
      break;
    // --- Projets
    case 'proj-new': projectModal(null); break;
    case 'proj-edit': projectModal(S.projects.find((x) => x.id === a.dataset.p)); break;
    case 'proj-archive': { const pr = S.projects.find((x) => x.id === a.dataset.p); pr.archived = true; save(); if (pr.tasks.length && pr.tasks.every((x) => x.done)) award(50, 'MISSION ACCOMPLIE !', pr.name); render(); break; }
    case 'proj-unarchive': S.projects.find((x) => x.id === a.dataset.p).archived = false; save(); render(); break;
    case 'proj-del':
      openModal(`<h2>Supprimer ce projet ?</h2><button class="btn btn-primary btn-block" data-action="proj-del-ok" data-p="${a.dataset.p}">Supprimer</button><button class="btn btn-ghost btn-block mt" data-action="modal-close">Annuler</button>`);
      break;
    case 'proj-del-ok': S.projects = S.projects.filter((x) => x.id !== a.dataset.p); save(); closeModal(); render(); break;
    case 'ptask-toggle': {
      const pr = S.projects.find((x) => x.id === a.dataset.p); const tk = pr.tasks.find((x) => x.id === a.dataset.t);
      tk.done = !tk.done; tk.doneAt = tk.done ? t : null;
      if (tk.done) award(10, 'GO !', 'Action faite'); else { S.xp = Math.max(0, S.xp - 10); save(); }
      render(); break;
    }
    case 'ptask-del': { const pr = S.projects.find((x) => x.id === a.dataset.p); pr.tasks = pr.tasks.filter((x) => x.id !== a.dataset.t); save(); render(); break; }
    case 'ptask-up': {
      const pr = S.projects.find((x) => x.id === a.dataset.p); const i = pr.tasks.findIndex((x) => x.id === a.dataset.t);
      if (i > 0) { [pr.tasks[i - 1], pr.tasks[i]] = [pr.tasks[i], pr.tasks[i - 1]]; save(); render(); }
      break;
    }
    // --- Famille
    case 'moment': { d.moments ||= {}; const on = !d.moments[a.dataset.p]; d.moments[a.dataset.p] = on; if (on) award(10, '❤️', `Moment avec ${person(a.dataset.p).name}`); else { S.xp = Math.max(0, S.xp - 10); save(); } render(); break; }
    case 'couple-week': { const ws = weekStart(t); const on = !S.family.couple[ws]; S.family.couple[ws] = on; if (on) award(20, 'TEAM !', 'Point couple'); else { S.xp = Math.max(0, S.xp - 20); save(); } render(); break; }
    case 'couple-date': { const m = monthOf(t); const on = !S.family.dates[m]; S.family.dates[m] = on; if (on) award(30, '💞', 'Sortie à deux'); else { S.xp = Math.max(0, S.xp - 30); save(); } render(); break; }
    case 'module-toggle': S.settings.modules[a.dataset.m] = !mod(a.dataset.m); save(); render(); break;
    case 'chore-new-today': choreModal(null, { freq: { type: 'once', date: t } }); break;
    case 'delegate': delegateModal(S.chores.find((c) => c.id === a.dataset.id)); break;
    case 'send-tasks': sendTasks(a.dataset.p); break;
    case 'copy-msg': { const ta = $('.modal textarea'); ta.select(); navigator.clipboard?.writeText(ta.value).then(() => toast('Copié !')).catch(() => document.execCommand('copy')); break; }
    case 'person-new': personModal(null); break;
    case 'person-edit': personModal(S.people.find((p) => p.id === a.dataset.id)); break;
    case 'person-del': {
      const p = S.people.find((x) => x.id === a.dataset.id);
      openModal(`<h2>Retirer ${esc(p.name)} ?</h2><p style="font-weight:700">Ses tâches te reviendront.</p>
        <button class="btn btn-primary btn-block" data-action="person-del-ok" data-id="${p.id}">Retirer</button>
        <button class="btn btn-ghost btn-block mt" data-action="modal-close">Annuler</button>`);
      break;
    }
    case 'person-del-ok': S.chores.forEach((c) => { if (c.who === a.dataset.id) c.who = 'me'; }); S.people = S.people.filter((p) => p.id !== a.dataset.id); save(); closeModal(); render(); break;
    case 'family-load':
      openModal(`<h2>🏠 Planning familial</h2>
        <p style="font-weight:700;margin-top:0">Charge le tableau des tâches de la maison : 19 tâches réparties entre toi, Maman, l’Ado et la Petite (repas, vaisselle, table, poubelles lundi et jeudi, lessive et recyclable une semaine sur deux, rangement ensemble le dimanche…).</p>
        <button class="btn btn-primary btn-block" data-action="family-ok" data-mode="replace">Remplacer mes tâches actuelles</button>
        <button class="btn btn-block mt" data-action="family-ok" data-mode="add">Ajouter aux tâches actuelles</button>
        <button class="btn btn-ghost btn-block mt" data-action="modal-close">Annuler</button>`);
      break;
    case 'family-ok': {
      for (const dp of defaultPeople()) if (!S.people.some((p) => p.id === dp.id)) S.people.push(dp);
      const fam = familyChores();
      S.chores = a.dataset.mode === 'replace' ? fam : S.chores.concat(fam);
      save(); closeModal(); render(); toast('Planning familial chargé', 'TEAM !');
      break;
    }
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
    case 'ptask-add': { const v = val('t'); const pr = S.projects.find((x) => x.id === f.dataset.p); if (v && pr) { pr.tasks.push({ id: uid(), t: v, done: false }); save(); render(); setTimeout(() => $(`[data-form="ptask-add"][data-p="${pr.id}"] input`)?.focus(), 0); } break; }
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
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (isRoute(h) && h !== route) { route = h; render(); } });

function start() {
  const h = location.hash.slice(1);
  route = isRoute(h) ? h : 'today';
  refreshRecurring();
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
