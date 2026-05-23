# Elezioni Comunali SBT 2026 — Scrutinio in tempo reale

Cron job GitHub Actions che scarica i risultati dello scrutinio dal portale
Eleweb del Comune di San Benedetto del Tronto ogni 5 minuti.

## Struttura `data/`

```
data/
├── meta.json                   ← stato corrente (timestamp, sezioni scrutinate, votanti)
├── totale_raggrup.json         ← voti per candidato sindaco (aggregato totale)
├── totale_liste.json           ← voti per lista (aggregato totale)
├── totale_candidati.json       ← preferenze per candidato consigliere (aggregato totale)
├── sezioni/
│   ├── 001/
│   │   ├── raggrup.json        ← voti per candidato sindaco, sezione 1
│   │   ├── liste.json          ← voti per lista, sezione 1
│   │   └── candidati.json      ← preferenze candidati, sezione 1
│   ├── 002/ ...
│   └── ...
└── history/
    └── 2026-05-25T15-30-00-000Z/
        ├── totale_raggrup.json
        ├── totale_liste.json
        └── totale_candidati.json
```

## Struttura JSON — chiavi principali

### `totale_raggrup.json`
```json
{
  "fetched_at": "2026-05-25T15:30:00.000Z",
  "snapshot": "20260522_103556",
  "anagrafica": [
    {
      "nraggrup": 1,
      "nome": "Giorgio Fede",
      "arrListe": [{ "nlista": 1, "nome": "PARTITO DEMOCRATICO" }, ...]
    }
  ],
  "voti": {
    "arrVotiRaggrup": {
      "1": { "voti": 1234, "voti_nona": 0, "voti_solosindpres": 0 },
      "2": { "voti": 456, ... },
      "3": { "voti": 789, ... }
    },
    "tot_sezio": 45,
    "iscri_totali": 38000,
    "tvotanti": 22000,
    "tvotival": 21800,
    "tbianche": 120,
    "tnulle": 80,
    "totale_parz": 45,
    "totale_gen": 70
  }
}
```

### `totale_liste.json`
```json
{
  "voti": {
    "arrVotiListe": {
      "1":  { "voti": 300, "voti_nona": 0 },
      "4":  { "voti": 450, "voti_nona": 0 },
      ...
    }
  }
}
```

## Candidati

| nraggrup | Candidato | Coalizione | Liste |
|---|---|---|---|
| 1 | Giorgio Fede | Centro-sinistra | 5 (AVS-PSI, Cambia SBT, M5S, PD, Progetto Civico) |
| 2 | Maria Elisa D'Andrea | Civica | 1 (Merito di Più) |
| 3 | Nicola Mozzoni | Centro-destra | 8 (Voce Nuova, NM-PPE, Lega, Insieme x SBT, FI, FdI, CCP-UDC, La Città Cambia Volto) |

## Configurazione

`N_SEZIONI` in `fetch-scrutinio.js`: SBT ha circa 70 sezioni — Eleweb restituisce
404 per sezioni non esistenti, quindi il fetch si ferma automaticamente.

## Fonte dati

Portale Eleweb del Comune di San Benedetto del Tronto:
`https://elezioni.comunesbt.it`

Dati **non ufficiali** (come indicato dal portale stesso).
