#!/usr/bin/env python3
"""
build_map_data.py
Legge i risultati per sezione e produce 2 GeoJSON per le mappe:
  data/sezioni_vincente.geojson   — 43 features (una per sezione)
  data/sedi_risultati.geojson     — 10 features (una per sede)

Da rieseguire ogni volta che fetch-scrutinio.js scarica nuovi dati.
"""

import json
from pathlib import Path

BASE = Path(__file__).parent / "data"

# ─── Candidati sindaco ────────────────────────────────────────────────────────
CANDIDATI = {
    "1": "Giorgio Fede",
    "2": "Maria Elisa D'Andrea",
    "3": "Nicola Mozzoni",
}
CAND_BREVE = {
    "1": "Fede",
    "2": "D'Andrea",
    "3": "Mozzoni",
}

# ─── Carica sezioni_con_sede.geojson ─────────────────────────────────────────
with open(BASE / "sezioni_con_sede.geojson", encoding="utf-8") as f:
    sezioni_geo = json.load(f)

# Index per numero sezione
sez_by_num = {
    feat["properties"]["sezione"]: feat
    for feat in sezioni_geo["features"]
}

# ─── Carica sedi_sezioni_elettorali.geojson ───────────────────────────────────
with open(BASE / "sedi_sezioni_elettorali.geojson", encoding="utf-8") as f:
    sedi_geo = json.load(f)

# ─── Legge voti per sezione ───────────────────────────────────────────────────
def read_sezione_voti(sez_num: int) -> dict:
    """Legge i voti dei 3 raggruppamenti per la sezione indicata."""
    path = BASE / "sezioni" / f"{sez_num:03d}" / "raggrup.json"
    if not path.exists():
        return {"1": 0, "2": 0, "3": 0}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    arr = data.get("voti", {}).get("arrVotiRaggrup", {})
    return {k: arr.get(k, {}).get("voti", 0) for k in ("1", "2", "3")}

# ─── Costruisci sezioni_vincente.geojson ─────────────────────────────────────
print("Costruzione sezioni_vincente.geojson ...")
sez_features = []

for sez_num in range(1, 44):
    feat = sez_by_num.get(sez_num)
    if not feat:
        continue

    voti = read_sezione_voti(sez_num)
    tot  = sum(voti.values())

    # Trova vincente
    if tot == 0:
        vincente_s    = "0"
        vincente_nome = "—"
    else:
        v_max = max(voti.values())
        winner_ids = [k for k, v in voti.items() if v == v_max]
        if len(winner_ids) > 1:
            vincente_s    = "0"   # parità
            vincente_nome = "parità"
        else:
            vincente_s    = winner_ids[0]
            vincente_nome = CAND_BREVE[vincente_s]

    props = {
        **feat["properties"],
        "voti_1":       voti["1"],
        "voti_2":       voti["2"],
        "voti_3":       voti["3"],
        "tot_voti":     tot,
        "vincente_s":   vincente_s,
        "vincente_nome": vincente_nome,
        "pct_1": round(100 * voti["1"] / tot, 1) if tot else 0,
        "pct_2": round(100 * voti["2"] / tot, 1) if tot else 0,
        "pct_3": round(100 * voti["3"] / tot, 1) if tot else 0,
    }
    sez_features.append({
        "type": "Feature",
        "geometry": feat["geometry"],
        "properties": props
    })

sezioni_vincente = {
    "type": "FeatureCollection",
    "name": "Risultati per Sezione – SBdT 2026",
    "features": sez_features
}
out1 = BASE / "sezioni_vincente.geojson"
with open(out1, "w", encoding="utf-8") as f:
    json.dump(sezioni_vincente, f, ensure_ascii=False, indent=2)
print(f"  ✓ {len(sez_features)} sezioni → {out1.name}")

# ─── Costruisci sedi_risultati.geojson ────────────────────────────────────────
print("Costruzione sedi_risultati.geojson ...")
sedi_features = []

for sede_feat in sedi_geo["features"]:
    p = sede_feat["properties"]
    sez_da = p["sez_da"]
    sez_a  = p["sez_a"]

    # Somma voti di tutte le sezioni di questa sede
    v1 = v2 = v3 = 0
    for sez_num in range(sez_da, sez_a + 1):
        v = read_sezione_voti(sez_num)
        v1 += v["1"]
        v2 += v["2"]
        v3 += v["3"]

    tot = v1 + v2 + v3

    props = {
        **p,
        "voti_1":  v1,
        "voti_2":  v2,
        "voti_3":  v3,
        "tot_voti": tot,
        "pct_1": round(100 * v1 / tot, 1) if tot else 0,
        "pct_2": round(100 * v2 / tot, 1) if tot else 0,
        "pct_3": round(100 * v3 / tot, 1) if tot else 0,
        "cand_1": CANDIDATI["1"],
        "cand_2": CANDIDATI["2"],
        "cand_3": CANDIDATI["3"],
    }
    sedi_features.append({
        "type": "Feature",
        "geometry": sede_feat["geometry"],
        "properties": props
    })

sedi_risultati = {
    "type": "FeatureCollection",
    "name": "Risultati per Sede – SBdT 2026",
    "features": sedi_features
}
out2 = BASE / "sedi_risultati.geojson"
with open(out2, "w", encoding="utf-8") as f:
    json.dump(sedi_risultati, f, ensure_ascii=False, indent=2)
print(f"  ✓ {len(sedi_features)} sedi    → {out2.name}")

# ─── Riepilogo ────────────────────────────────────────────────────────────────
tot_voti_all = sum(f["properties"]["tot_voti"] for f in sez_features)
print(f"\nVoti totali scrutinati: {tot_voti_all}")
for cid, nome in CANDIDATI.items():
    v = sum(f["properties"][f"voti_{cid}"] for f in sez_features)
    pct = round(100 * v / tot_voti_all, 1) if tot_voti_all else 0
    print(f"  {nome}: {v} ({pct}%)")
