#!/usr/bin/env python3
"""
Convertit un modèle scikit-learn (.joblib) en fichier JSON léger (modele_cultures.json)
exécutable directement par le serveur Node.js (server.ts) sans avoir besoin de Python/scikit-learn en production.

Usage :
  python models/export_joblib_to_json.py chemin/vers/mon_modele.joblib models/modele_cultures.json
"""
import json
import sys
from pathlib import Path


def export_tree(tree_estimator):
    t = tree_estimator.tree_
    return {
        "children_left": [int(x) for x in t.children_left],
        "children_right": [int(x) for x in t.children_right],
        "feature": [int(x) for x in t.feature],
        "threshold": [float(x) for x in t.threshold],
        "value": [[float(v) for v in row[0]] for row in t.value],
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python models/export_joblib_to_json.py <entree.joblib> [sortie.json]")
        sys.exit(1)

    import joblib  # type: ignore

    in_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) >= 3 else Path("models/modele_cultures.json")

    loaded = joblib.load(in_path)
    label_encoder = None
    model = loaded
    if isinstance(loaded, dict):
        model = loaded.get("model") or loaded.get("classifier") or loaded.get("estimator") or loaded.get("pipeline")
        label_encoder = loaded.get("label_encoder") or loaded.get("encoder")

    steps = []
    estimator = model
    feature_names = [str(f) for f in getattr(model, "feature_names_in_", [])]

    if hasattr(model, "steps"):
        for name, step in model.steps[:-1]:
            if not feature_names and hasattr(step, "feature_names_in_"):
                feature_names = [str(f) for f in step.feature_names_in_]
            cls_name = step.__class__.__name__
            if cls_name == "StandardScaler":
                steps.append(
                    {
                        "type": "StandardScaler",
                        "mean": [float(x) for x in getattr(step, "mean_", [])],
                        "scale": [float(x) if float(x) != 0.0 else 1.0 for x in getattr(step, "scale_", [])],
                    }
                )
            elif cls_name == "SimpleImputer":
                steps.append(
                    {
                        "type": "SimpleImputer",
                        "statistics": [float(x) for x in getattr(step, "statistics_", [])],
                    }
                )
            else:
                raise RuntimeError(f"Étape Pipeline non supportée pour export JSON : {cls_name}")
        estimator = model.steps[-1][1]

    if not feature_names and hasattr(estimator, "feature_names_in_"):
        feature_names = [str(f) for f in estimator.feature_names_in_]

    raw_classes = getattr(estimator, "classes_", [])
    if label_encoder is not None:
        classes = [str(x) for x in label_encoder.inverse_transform(raw_classes)]
    else:
        classes = [str(x) for x in raw_classes]

    est_name = estimator.__class__.__name__
    payload = {
        "format": "gitagro_sklearn_export_v1",
        "source_joblib": in_path.name,
        "estimator_type": est_name,
        "feature_names": feature_names,
        "n_features": int(getattr(estimator, "n_features_in_", len(feature_names))),
        "classes": classes,
        "preprocessing": steps,
    }

    if est_name in ("RandomForestClassifier", "ExtraTreesClassifier"):
        payload["trees"] = [export_tree(est) for est in estimator.estimators_]
    elif est_name == "DecisionTreeClassifier":
        payload["trees"] = [export_tree(estimator)]
    elif est_name == "LogisticRegression":
        payload["coef"] = [[float(v) for v in row] for row in estimator.coef_]
        payload["intercept"] = [float(v) for v in estimator.intercept_]
    else:
        raise RuntimeError(
            f"Type de modèle '{est_name}' non supporté par export_joblib_to_json.py. "
            "Utilisez RandomForestClassifier, ExtraTreesClassifier, DecisionTreeClassifier ou LogisticRegression, "
            "ou exécutez le fichier .joblib via Python (models/predict_joblib.py)."
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"Modèle exporté avec succès vers {out_path} ({est_name}, {len(classes)} cultures : {', '.join(classes)})")


if __name__ == "__main__":
    main()
