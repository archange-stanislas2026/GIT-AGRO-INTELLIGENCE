#!/usr/bin/env python3
"""
Inférence locale directe depuis un fichier .joblib placé dans /models/.
Supporte :
1. Les modèles spatiaux FAO/AHP/facteur limitant sérialisés en pickle+zlib (ex: modele_cultures.joblib),
   sans aucune dépendance externe (utilise uniquement zlib + pickle de Python).
2. Les modèles scikit-learn classiques si joblib + scikit-learn + numpy sont installés.
"""
import json
import pickle
import sys
import zlib
from pathlib import Path


NORMALIZED_ALIASES = {
    "pluie": "pluie_mm",
    "pluie_mm": "pluie_mm",
    "pluie_annuelle": "pluie_mm",
    "pluie_annuelle_mm": "pluie_mm",
    "precipitation": "pluie_mm",
    "precipitations": "pluie_mm",
    "rain": "pluie_mm",
    "rainfall": "pluie_mm",
    "prectotcorr": "pluie_mm",
    "temp": "temp_max_c",
    "temp_c": "temp_max_c",
    "temp_max": "temp_max_c",
    "temp_max_c": "temp_max_c",
    "temp_max_moyenne_c": "temp_max_c",
    "temperature": "temp_max_c",
    "temperature_max": "temp_max_c",
    "t2m_max": "temp_max_c",
    "temp_moy": "temp_moyenne_c",
    "temp_moyenne": "temp_moyenne_c",
    "temp_moyenne_c": "temp_moyenne_c",
    "t2m": "temp_moyenne_c",
    "altitude": "altitude_m",
    "altitude_m": "altitude_m",
    "elevation": "altitude_m",
    "elevation_m": "altitude_m",
    "pente": "pente_deg",
    "pente_deg": "pente_deg",
    "slope": "pente_deg",
    "slope_deg": "pente_deg",
    "ph": "ph_sol",
    "ph_sol": "ph_sol",
    "phh2o": "ph_sol",
    "azote": "azote_sol",
    "azote_sol": "azote_sol",
    "nitrogen": "azote_sol",
    "n": "azote_sol",
    "argile": "argile_pct",
    "argile_pct": "argile_pct",
    "clay": "argile_pct",
    "lat": "lat",
    "latitude": "lat",
    "lon": "lon",
    "lng": "lon",
    "longitude": "lon",
    "budget": "budget_usd",
    "budget_usd": "budget_usd",
    "surface": "surface_ares",
    "surface_ares": "surface_ares",
    "ndvi": "ndvi",
}


def load_joblib_or_zlib_pickle(model_path: Path):
    try:
        import joblib  # type: ignore
        return joblib.load(model_path)
    except ImportError:
        raw = model_path.read_bytes()
        # Try zlib-compressed pickle (standard joblib compress=1..9 on pure-Python dicts/lists)
        for attempt in (lambda b: pickle.loads(zlib.decompress(b)), lambda b: pickle.loads(b)):
            try:
                return attempt(raw)
            except Exception:
                continue
        raise


def fao_factor_score(val, bounds, scores_arr):
    if val is None:
        return None
    if val < bounds[0]:
        return scores_arr[0]
    if val < bounds[1]:
        return scores_arr[1]
    if val <= bounds[2]:
        return scores_arr[2]
    if val <= bounds[3]:
        return scores_arr[3]
    return scores_arr[4]


def run_fao_ahp_spatial_model(obj: dict, features_payload: dict, model_name: str) -> dict:
    grille = obj.get("grille", {})
    couches = grille.get("couches", {})
    lat_min = float(grille.get("lat_min", -5.0))
    lon_min = float(grille.get("lon_min", 26.8))
    pas = float(grille.get("pas", 0.05))
    n_lat = int(grille.get("n_lat", 0))
    n_lon = int(grille.get("n_lon", 0))

    lat = features_payload.get("lat")
    lon = features_payload.get("lon")
    if lat is None or lon is None:
        return {"ok": False, "error": "MISSING_COORDS", "detail": "Latitude et longitude requises pour le modèle spatial."}

    i_lat = max(0, min(n_lat - 1, round((float(lat) - lat_min) / pas)))
    i_lon = max(0, min(n_lon - 1, round((float(lon) - lon_min) / pas)))

    def get_cell(r: int, c: int):
        idx = r * n_lon + c
        return {k: couches[k][idx] for k in couches}

    cell = get_cell(i_lat, i_lon)
    # If exact coastal/border pixel has no data, check immediate 1-cell neighborhood
    if cell.get("t0") is None and cell.get("altitude") is None:
        best_cell = None
        best_dist = 999
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                nr, nc = i_lat + dr, i_lon + dc
                if 0 <= nr < n_lat and 0 <= nc < n_lon:
                    cand = get_cell(nr, nc)
                    if cand.get("t0") is not None or cand.get("altitude") is not None:
                        d = abs(dr) + abs(dc)
                        if d < best_dist:
                            best_dist = d
                            best_cell = cand
        if best_cell is not None:
            cell = best_cell

    grad = float(obj.get("gradient_c_par_m", 0.0065))
    scores_arr = obj.get("scores", [0, 50, 100, 50, 0])
    seuils = obj.get("seuils_classes", {"apte": 75, "moyennement_apte": 45})
    facteurs_meta = obj.get("facteurs", {})

    alt_val = cell.get("altitude")
    if alt_val is None:
        alt_val = features_payload.get("altitude_m")

    t0_val = cell.get("t0")
    if t0_val is not None and alt_val is not None:
        temp_val = round(float(t0_val) - grad * float(alt_val), 2)
    else:
        temp_val = features_payload.get("temp_moyenne_c") or features_payload.get("temp_max_c")

    pluie_val = cell.get("pluie")
    if pluie_val is None:
        pluie_val = features_payload.get("pluie_mm")

    ph_val = cell.get("ph")
    if ph_val is None:
        ph_val = features_payload.get("ph_sol")

    cec_val = cell.get("cec")
    cos_val = cell.get("cos")
    aire_protegee = cell.get("aire_protegee")
    lulc = cell.get("lulc")

    vals = {
        "T": temp_val,
        "P": pluie_val,
        "ALT": alt_val,
        "pH": ph_val,
        "CEC": cec_val,
        "COS": cos_val,
    }

    ranked = []
    for cult in obj.get("cultures", []):
        exigences = cult.get("exigences", {})
        poids = cult.get("poids", {})
        raisons = []
        vigilances = []
        factor_scores = {}
        weighted_sum = 0.0
        weight_total = 0.0
        min_score = 100

        for f_key, bounds in exigences.items():
            v = vals.get(f_key)
            s = fao_factor_score(v, bounds, scores_arr)
            factor_scores[f_key] = s
            f_info = facteurs_meta.get(f_key, {})
            f_label = f_info.get("nom", f_key)
            unite = f_info.get("unite", "")
            u_str = f" {unite}".rstrip()

            if s is not None:
                w = float(poids.get(f_key, 0.0))
                weighted_sum += w * s
                weight_total += w
                if s < min_score:
                    min_score = s

                if s >= 100:
                    if f_key in ("T", "P", "ALT", "pH"):
                        raisons.append(f"{f_label.capitalize()} optimale ({v}{u_str})")
                elif s >= 50:
                    vigilances.append(f"{f_label.capitalize()} modérément favorable ({v}{u_str})")
                else:
                    vigilances.append(
                        f"Facteur limitant ({f_label} = {v}{u_str}, plage tolérée {bounds[0]}–{bounds[3]}{u_str})"
                    )

        ahp_score = round(weighted_sum / weight_total, 1) if weight_total > 0 else 0.0
        # Règle du facteur limitant : si un facteur tombe à 0, l'aptitude est bloquée à 0
        final_score = 0.0 if min_score == 0 else ahp_score

        if final_score >= seuils.get("apte", 75):
            classe = "Apte"
        elif final_score >= seuils.get("moyennement_apte", 45):
            classe = "Moyennement apte"
        else:
            classe = "Inapte / Sous contrainte"

        if aire_protegee == 1:
            vigilances.insert(0, "Parcelle située dans une aire protégée répertoriée (vérifier autorisation locale)")

        ranked.append(
            {
                "code": cult["code"],
                "nom": cult["nom"],
                "score_final": final_score,
                "score_ahp": ahp_score,
                "classe_aptitude": classe,
                "facteurs_scores": factor_scores,
                "raisons_agronomiques": raisons if raisons else ["Évaluation AHP effectuée sur les couches du modèle"],
                "points_vigilance": vigilances,
            }
        )

    ranked.sort(key=lambda c: (c["score_final"], c["score_ahp"]), reverse=True)
    top = ranked[0]

    # Build normalized probabilities for display compatibility
    score_basis = [max(1.0, c["score_final"] if top["score_final"] > 0 else c["score_ahp"]) for c in ranked]
    total_basis = sum(score_basis) or 1.0
    probabilites = {c["nom"]: round(sb / total_basis, 4) for c, sb in zip(ranked, score_basis)}

    return {
        "ok": True,
        "model_type": "fao_ahp_spatial",
        "model_file": model_name,
        "methodologie": obj.get("methodologie"),
        "version": obj.get("version"),
        "culture": top["nom"],
        "probabilites": probabilites,
        "classement_detaille": ranked,
        "cellule_grille": {
            "row": i_lat,
            "col": i_lon,
            "T_c": temp_val,
            "P_mm": pluie_val,
            "ALT_m": alt_val,
            "pH": ph_val,
            "CEC": cec_val,
            "COS_pct": cos_val,
            "lulc": lulc,
            "aire_protegee": aire_protegee,
            "sources": obj.get("sources"),
        },
        "features_used": vals,
    }


def resolve_feature_value(feature_name: str, payload: dict) -> float:
    key = str(feature_name).strip().lower().replace(" ", "_")
    canonical = NORMALIZED_ALIASES.get(key, key)
    val = payload.get(canonical, payload.get(feature_name))
    if val is None:
        return float("nan")
    try:
        return float(val)
    except (TypeError, ValueError):
        return float("nan")


def main() -> None:
    raw_input = sys.stdin.read().strip()
    if not raw_input:
        print(json.dumps({"ok": False, "error": "EMPTY_INPUT", "detail": "Entrée JSON vide."}))
        return

    req = json.loads(raw_input)
    model_path = Path(req.get("model_path", ""))
    features_payload = req.get("features", {})

    if not model_path.is_file():
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "MODEL_NOT_FOUND",
                    "detail": f"Fichier modèle introuvable : {model_path}",
                },
                ensure_ascii=False,
            )
        )
        return

    try:
        loaded = load_joblib_or_zlib_pickle(model_path)
    except ImportError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "MISSING_PYTHON_DEPS",
                    "detail": f"Dépendances Python manquantes pour lire ce .joblib ({exc}). Installez joblib et scikit-learn ou exportez le modèle en JSON avec models/export_joblib_to_json.py.",
                },
                ensure_ascii=False,
            )
        )
        return
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "LOAD_ERROR",
                    "detail": f"Impossible de charger {model_path.name} : {exc}",
                },
                ensure_ascii=False,
            )
        )
        return

    # Case 1: Spatial FAO/AHP/Limiting-factor Sud-Kivu model dict (like modele_cultures.joblib)
    if isinstance(loaded, dict) and "cultures" in loaded and "grille" in loaded:
        out = run_fao_ahp_spatial_model(loaded, features_payload, model_path.name)
        print(json.dumps(out, ensure_ascii=False))
        return

    # Case 2: Standard scikit-learn classifier / pipeline
    try:
        import numpy as np  # type: ignore
    except ImportError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "MISSING_PYTHON_DEPS",
                    "detail": f"Dépendances Python manquantes ({exc}).",
                },
                ensure_ascii=False,
            )
        )
        return

    label_encoder = None
    model = loaded
    if isinstance(loaded, dict):
        model = loaded.get("model") or loaded.get("classifier") or loaded.get("estimator") or loaded.get("pipeline")
        label_encoder = loaded.get("label_encoder") or loaded.get("encoder")
        if model is None:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": "INVALID_MODEL_DICT",
                        "detail": "Le fichier .joblib contient un dictionnaire sans clé 'model'/'classifier'/'estimator'.",
                    },
                    ensure_ascii=False,
                )
            )
            return

    feature_names = getattr(model, "feature_names_in_", None)
    if feature_names is not None:
        ordered_names = [str(f) for f in feature_names]
    else:
        default_order = [
            "pluie_mm",
            "temp_max_c",
            "altitude_m",
            "pente_deg",
            "ph_sol",
            "azote_sol",
            "argile_pct",
        ]
        n_expected = int(getattr(model, "n_features_in_", len(default_order)))
        ordered_names = default_order[:n_expected]

    vector = [resolve_feature_value(name, features_payload) for name in ordered_names]
    X = np.array([vector], dtype=float)

    if np.isnan(X).any() and not hasattr(model, "named_steps"):
        X = np.nan_to_num(X, nan=0.0)

    pred_raw = model.predict(X)[0]
    if label_encoder is not None:
        try:
            pred_label = str(label_encoder.inverse_transform([pred_raw])[0])
        except Exception:
            pred_label = str(pred_raw)
    else:
        pred_label = str(pred_raw)

    probabilites = {}
    if hasattr(model, "predict_proba") and hasattr(model, "classes_"):
        probs = model.predict_proba(X)[0]
        raw_classes = model.classes_
        for cls_val, p in zip(raw_classes, probs):
            if label_encoder is not None:
                try:
                    cls_name = str(label_encoder.inverse_transform([cls_val])[0])
                except Exception:
                    cls_name = str(cls_val)
            else:
                cls_name = str(cls_val)
            probabilites[cls_name] = round(float(p), 4)

    print(
        json.dumps(
            {
                "ok": True,
                "model_type": "sklearn",
                "model_file": model_path.name,
                "culture": pred_label,
                "probabilites": probabilites,
                "features_used": dict(zip(ordered_names, [None if np.isnan(v) else float(v) for v in vector])),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
