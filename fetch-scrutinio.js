#!/usr/bin/env node

/**
 * fetch-scrutinio.js
 * Scarica i risultati dello scrutinio delle elezioni comunali
 * di San Benedetto del Tronto dal portale Eleweb.
 *
 * Struttura URL Eleweb (corretta):
 *   Snapshot:  /static_json/online/folder.js
 *                → contiene: folderToRead = 'YYYYMMDD_HHMMSS'
 *
 *   Totali (sezione 0):
 *     /static_json/online/{SNAPSHOT}/{CDELE_NUMERIC}/voti_raggrup_{PARTIZIONE}.json
 *     /static_json/online/{SNAPSHOT}/{CDELE_NUMERIC}/voti_liste_{PARTIZIONE}.json
 *     /static_json/online/{SNAPSHOT}/{CDELE_NUMERIC}/voti_candi_{PARTIZIONE}.json
 *
 *   Per sezione N:
 *     /static_json/online/{SNAPSHOT}/{CDELE_NUMERIC}/voti_raggrup_{PARTIZIONE}_{N}.json
 *     /static_json/online/{SNAPSHOT}/{CDELE_NUMERIC}/voti_liste_{PARTIZIONE}_{N}.json
 *     /static_json/online/{SNAPSHOT}/{CDELE_NUMERIC}/voti_candi_{PARTIZIONE}_{N}.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ─── configurazione ──────────────────────────────────────────────────────────

const BASE_SITE      = 'https://elezioni.comunesbt.it';
const CDELE_NUMERIC  = '1';    // parte numerica di macro_cdele "N1"
const PARTIZIONE     = '0';    // idpartizione (SBT usa 0)
const N_SEZIONI      = 70;     // SBT ha ~70 sezioni — Eleweb restituisce 404 per quelle inesistenti
const DATA_DIR       = path.join(__dirname, 'data');
const HISTORY_DIR    = path.join(DATA_DIR, 'history');

// URL da cui estrarre il timestamp snapshot corrente
const FOLDER_JS_URL  = `${BASE_SITE}/static_json/online/folder.js`;

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
 * Legge il timestamp snapshot da folder.js.
 * Il file contiene una riga tipo:
 *   folderToRead = '20260522_103556'
 */
async function resolveSnapshotPath() {
  console.log('Resolving snapshot path from folder.js...');
  const js = await fetchText(`${FOLDER_JS_URL}?_=${Date.now()}`);
  const match = js.match(/folderToRead\s*=\s*['"](\d{8}_\d{6})['"]/);
  if (!match) throw new Error(`Snapshot non trovato in folder.js. Contenuto: ${js.slice(0, 200)}`);
  console.log(`  snapshot: ${match[1]}`);
  return match[1];
}

/**
 * Costruisce l'URL per totale (sez=null) o singola sezione (sez=N).
 * tipo: 'voti_raggrup' | 'voti_liste' | 'voti_candi'
 */
function buildUrl(snapshot, tipo, sez) {
  const suffix = sez == null
    ? `${tipo}_${PARTIZIONE}.json`
    : `${tipo}_${PARTIZIONE}_${sez}.json`;
  return `${BASE_SITE}/static_json/online/${snapshot}/${CDELE_NUMERIC}/${suffix}`;
}

function saveJSON(filename, obj) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(obj, null, 2), 'utf8');
}

// ─── fetch per tipo ───────────────────────────────────────────────────────────

async function fetchRaggrup(snapshot, sez) {
  const url = buildUrl(snapshot, 'voti_raggrup', sez);
  try { return await fetchJSON(url); }
  catch (e) { if (e.message.startsWith('HTTP 404')) return null; throw e; }
}

async function fetchListe(snapshot, sez) {
  const url = buildUrl(snapshot, 'voti_liste', sez);
  try { return await fetchJSON(url); }
  catch (e) { if (e.message.startsWith('HTTP 404')) return null; throw e; }
}

async function fetchCandidati(snapshot, sez) {
  const url = buildUrl(snapshot, 'voti_candi', sez);
  try { return await fetchJSON(url); }
  catch (e) { if (e.message.startsWith('HTTP 404')) return null; throw e; }
}

// Affluenza intermedia: prova cdafflu 1‥10, raccoglie totali + per-sezione
async function fetchAffluenza(snapshot) {
  const slots   = [];
  const sezioni = {};   // { [cdafflu]: { [nrsez]: { tvotanti, iscri_totale } } }

  for (let cdafflu = 1; cdafflu <= 10; cdafflu++) {
    const urlTot = `${BASE_SITE}/static_json/online/${snapshot}/${CDELE_NUMERIC}/voti_afflu_${PARTIZIONE}_${cdafflu}.json`;
    let dTot;
    try {
      dTot = await fetchJSON(urlTot);
    } catch (e) {
      if (e.message.startsWith('HTTP 404')) continue;
      throw e;
    }
    slots.push({ cdafflu, ...dTot });

    // scarica per-sezione a blocchi di 5 (evita socket hang up per troppe richieste parallele)
    sezioni[cdafflu] = {};
    const AFFLU_BATCH = 5;
    for (let start = 1; start <= N_SEZIONI; start += AFFLU_BATCH) {
      const end   = Math.min(start + AFFLU_BATCH - 1, N_SEZIONI);
      const batch = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      await Promise.all(batch.map(async s => {
        const urlSez = `${BASE_SITE}/static_json/online/${snapshot}/${CDELE_NUMERIC}/voti_afflu_${PARTIZIONE}_${cdafflu}_${s}.json`;
        try {
          const d = await fetchJSON(urlSez);
          sezioni[cdafflu][s] = { tvotanti: d.tvotanti || 0, iscri_totale: d.iscri_totale || 0 };
        } catch (e) {
          if (!e.message.startsWith('HTTP 404')) throw e;
        }
      }));
    }
    console.log(`  affluenza cdafflu=${cdafflu} (${dTot.anagrafica?.descrizione}): ${dTot.tvotanti} votanti`);
  }
  return { slots, sezioni };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const fetchedAt = new Date().toISOString();
  console.log(`\n=== fetch-scrutinio.js  ${fetchedAt} ===\n`);

  // 1) risolvi snapshot path
  const snapshot = await resolveSnapshotPath();

  // 2) scarica totali (sezione 0 = aggregato) + affluenza intermedia
  console.log('Fetching totals + affluenza...');
  const [raggrupTot, listeTot, candidatiTot, affluenza] = await Promise.all([
    fetchRaggrup(snapshot, null),
    fetchListe(snapshot, null),
    fetchCandidati(snapshot, null),
    fetchAffluenza(snapshot),
  ]);
  const { slots: affluenzaSlots, sezioni: affluenzaSezioni } = affluenza;

  const timestamp = fetchedAt.replace(/[:.]/g, '-');

  // salva latest
  if (raggrupTot)   saveJSON(path.join(DATA_DIR, 'totale_raggrup.json'),   { fetched_at: fetchedAt, snapshot, ...raggrupTot });
  if (listeTot)     saveJSON(path.join(DATA_DIR, 'totale_liste.json'),     { fetched_at: fetchedAt, snapshot, ...listeTot });
  if (candidatiTot) saveJSON(path.join(DATA_DIR, 'totale_candidati.json'), { fetched_at: fetchedAt, snapshot, ...candidatiTot });
  saveJSON(path.join(DATA_DIR, 'affluenza.json'),         { fetched_at: fetchedAt, snapshot, slots: affluenzaSlots });
  saveJSON(path.join(DATA_DIR, 'affluenza_sezioni.json'), { fetched_at: fetchedAt, snapshot, sezioni: affluenzaSezioni });
  console.log(`  affluenza slots trovati: ${affluenzaSlots.length}`);

  // salva history snapshot
  const histDir = path.join(HISTORY_DIR, timestamp);
  if (raggrupTot)   saveJSON(path.join(histDir, 'totale_raggrup.json'),   raggrupTot);
  if (listeTot)     saveJSON(path.join(histDir, 'totale_liste.json'),     listeTot);
  if (candidatiTot) saveJSON(path.join(histDir, 'totale_candidati.json'), candidatiTot);

  // 3) scarica per sezione (parallelo, a blocchi di 3 — 3 sez × 3 file = 9 conn simultanee)
  console.log(`Fetching up to ${N_SEZIONI} sezioni...`);
  const sezioniData = [];
  const BATCH = 3;

  outer:
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
        console.log(`  sezione ${r.sezione}: not found — fine sezioni`);
        break outer;
      }
      sezioniData.push(r);
      process.stdout.write(`  sezione ${r.sezione} ok\n`);
    }
  }

  // salva per sezione
  for (const { sezione, raggrup, liste, cand } of sezioniData) {
    const dir = path.join(DATA_DIR, 'sezioni', String(sezione).padStart(3, '0'));
    if (raggrup) saveJSON(path.join(dir, 'raggrup.json'),   raggrup);
    if (liste)   saveJSON(path.join(dir, 'liste.json'),     liste);
    if (cand)    saveJSON(path.join(dir, 'candidati.json'), cand);
  }

  // 4) scrivi meta.json con stato corrente
  const meta = {
    fetched_at:         fetchedAt,
    snapshot,
    sezioni_total:      sezioniData.length,
    sezioni_scrutinate: raggrupTot?.voti?.tot_sezio ?? null,
    iscritti:           raggrupTot?.voti?.iscri_totali ?? null,
    votanti:            raggrupTot?.voti?.tvotanti ?? null,
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
