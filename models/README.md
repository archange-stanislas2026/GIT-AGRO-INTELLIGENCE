# Dossier du modèle local (`models/`)

Le fichier **`models/modele_cultures.joblib`** est détecté et exécuté **directement** par le serveur local (`server.ts` via `models/predict_joblib.py`) sans aucun appel à Render.

- **Votre fichier `modele_cultures.joblib` actuel** (modèle spatial FAO / AHP / facteur limitant à 7 cultures sur grille Sud-Kivu) est sérialisé avec `zlib + pickle` pur Python : **aucun fichier `.json` supplémentaire n'est nécessaire**, il fonctionne directement tel quel !
- *(Uniquement si vous remplacez plus tard ce fichier par un modèle `scikit-learn` tel que `RandomForestClassifier` sur un serveur Node sans `scikit-learn` installé, vous pourrez utiliser `models/export_joblib_to_json.py`.)*
