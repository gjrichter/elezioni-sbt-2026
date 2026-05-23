#!/usr/bin/env node

/**
 * fetch-scrutinio.js
 * Scarica i risultati dello scrutinio delle elezioni comunali
 * di San Benedetto del Tronto dal portale Eleweb.
 *
 * Struttura URL Eleweb:
 *   /static_json/online/{SNAPSHOT}/{PARTIZIONE}/voti_raggrup_{SEZIONE}.json
 *   /static_json/online/{SNAPSHOT}/{PARTIZIONE}/voti_liste_{SEZIONE}.json
 *   /static_json/online/{SNAPSHOT}/{PARTIZIONE}/voti_cand_{SEZIONE}.json
 *
 * SEZIONE 0 = totale aggregato; 1..N = singole sezioni
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ─── configurazione ──────────────────────────────────────────────────────────

const BASE_SITE      = 'https://elezioni.comunesbt.it';
const CDELE          = 'N1';
const PARTIZIONE     = '1';
const N_SEZIONI      = 70;   // SBT ha ~70 sezioni — aggiusta se necessario
const DATA_DIR       = path.join(__dirname, 'data');
const HISTORY_DIR    = path.join(DATA_DIR, 'history');

// pagina HTML da cui estrarre lo snapshot path (cambia ad ogni deploy Eleweb)
const ENTRY_PAGE     = `${BASE_SITE}/amministrative/voti_raggrup.html?cdele=${CDELE}`;

// ─── helpers ─────────────────────────────────────────────────────────────────

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        else resolve(body);
      });
    }).on('error', reject);
  });
}

async function fetchJSON(url) {
  // aggiunge cache-buster per evitare risposte cached
  const bust = `${url}?_=${Date.now()}`;
  const text = await fetchText(bust);
  return JSON.parse(text);
}

/**
 * Trova il path snapshot corrente leggendo la pagina HTML.
 * Eleweb inietta il path come variabile JS oppure come URL in un <script src>.
 * Pattern atteso: static_json/online/YYYYMMDD_HHMMSS
 */
async function resolveSnapshotPath() {
  console.log('Resolving snapshot path from entry page...');
  const html = await fetchText(ENTRY_PAGE);
  const match = html.match(/static_json\/online\/(\d{8}_\d{6})/);
  if (!match) throw new Error('Snapshot path non trovato nella pagina HTML. Controlla ENTRY_PAGE.');
  console.log(`  snapshot: ${match[1]}`);
  return match[1];
}

function buildUrl(snapshot, tipo, sezione) {
  // tipo: 'voti_raggrup' | 'voti_liste' | 'voti_cand'
  return `${BASE_SITE}/static_json/online/${snapshot}/${PARTIZIONE}/${tipo}_${sezione}.json`;
}

function saveJSON(filename, obj) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(obj, null, 2), 'utf8');
}

// ─── fetch per tipo ───────────────────────────────────────────────────────────

/**
 * Scarica i voti aggregati per coalizione/candidato (voti_raggrup).
 * sezione=0 → totale; sezione=N → singola sezione.
 */
async function fetchRaggrup(snapshot, sezione) {
  const url = buildUrl(snapshot, 'voti_raggrup', sezione);
  try {
    return await fetchJSON(url);
  } catch (e) {
    if (e.message.startsWith('HTTP 404')) return null;
    throw e;
  }
}

/**
 * Scarica i voti per lista.
 */
async function fetchListe(snapshot, sezione) {
  const url = buildUrl(snapshot, 'voti_liste', sezione);
  try {
    return await fetchJSON(url);
  } catch (e) {
    if (e.message.startsWith('HTTP 404')) return null;
    throw e;
  }
}

/**
 * Scarica le preferenze per candidato consigliere.
 */
async function fetchCandidati(snapshot, sezione) {
  const url = buildUrl(snapshot, 'voti_cand', sezione);
  try {
    return await fetchJSON(url);
  } catch (e) {
    if (e.message.startsWith('HTTP 404')) return null;
    throw e;
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const fetchedAt = new Date().toISOString();
  console.log(`\n=== fetch-scrutinio.js  ${fetchedAt} ===\n`);

  // 1) risolvi snapshot path
  const snapshot = await resolveSnapshotPath();

  // 2) scarica totali (sezione 0)
  console.log('Fetching totals (sezione 0)...');
  const [raggrupTot, listeTot, candidatiTot] = await Promise.all([
    fetchRaggrup(snapshot, 0),
    fetchListe(snapshot, 0),
    fetchCandidati(snapshot, 0),
  ]);

  const timestamp = fetchedAt.replace(/[:.]/g, '-');

  // salva latest
  if (raggrupTot)    saveJSON(path.join(DATA_DIR, 'totale_raggrup.json'),    { fetched_at: fetchedAt, snapshot, ...raggrupTot });
  if (listeTot)      saveJSON(path.join(DATA_DIR, 'totale_liste.json'),      { fetched_at: fetchedAt, snapshot, ...listeTot });
  if (candidatiTot)  saveJSON(path.join(DATA_DIR, 'totale_candidati.json'),  { fetched_at: fetchedAt, snapshot, ...candidatiTot });

  // salva history snapshot
  const histDir = path.join(HISTORY_DIR, timestamp);
  if (raggrupTot)    saveJSON(path.join(histDir, 'totale_raggrup.json'),    raggrupTot);
  if (listeTot)      saveJSON(path.join(histDir, 'totale_liste.json'),      listeTot);
  if (candidatiTot)  saveJSON(path.join(histDir, 'totale_candidati.json'),  candidatiTot);

  // 3) scarica per sezione (parallelo, a blocchi di 10)
  console.log(`Fetching ${N_SEZIONI} sezioni...`);
  const sezioniData = [];
  const BATCH = 10;

  for (let start = 1; start <= N_SEZIONI; start += BATCH) {
    const end = Math.min(start + BATCH - 1, N_SEZIONI);
    const batch = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    const results = await Promise.all(batch.map(async s => {
      const [raggrup, liste, cand] = await Promise.all([
        fetchRaggrup(snapshot, s),
        fetchListe(snapshot, s),
        fetchCandidati(snapshot, s),
      ]);
      return { sezione: s, raggrup, liste, cand };
    }));

    for (const r of results) {
      if (!r.raggrup && !r.liste) {
        console.log(`  sezione ${r.sezione}: not found (fine sezioni)`);
        break; // Eleweb restituisce 404 per sezioni non esistenti
      }
      sezioniData.push(r);
      process.stdout.write(`  sezione ${r.sezione} ok\n`);
    }
  }

  // salva per sezione
  for (const { sezione, raggrup, liste, cand } of sezioniData) {
    const dir = path.join(DATA_DIR, 'sezioni', String(sezione).padStart(3, '0'));
    if (raggrup)  saveJSON(path.join(dir, 'raggrup.json'),   raggrup);
    if (liste)    saveJSON(path.join(dir, 'liste.json'),     liste);
    if (cand)     saveJSON(path.join(dir, 'candidati.json'), cand);
  }

  // 4) scrivi meta.json con stato corrente
  const meta = {
    fetched_at:    fetchedAt,
    snapshot,
    sezioni_total: sezioniData.length,
    sezioni_scrutinate: (() => {
      if (!raggrupTot) return null;
      return raggrupTot.voti?.tot_sezio ?? null;
    })(),
    iscritti: raggrupTot?.voti?.iscri_totali ?? null,
    votanti:  raggrupTot?.voti?.tvotanti ?? null,
  };
  saveJSON(path.join(DATA_DIR, 'meta.json'), meta);

  console.log('\n✓ Done.');
  console.log(`  sezioni scaricate: ${sezioniData.length}`);
  console.log(`  sezioni scrutinate: ${meta.sezioni_scrutinate}`);
  console.log(`  votanti: ${meta.votanti}`);
}

main().catch(err => {
  console.error('\n✗ ERRORE:', err.message);
  process.exit(1);
});
