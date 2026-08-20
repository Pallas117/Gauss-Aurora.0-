import json
import numpy as np
from pathlib import Path
from sklearn.ensemble import IsolationForest
from typing import List, Dict, Any, Optional

class IsolationForestDetector:
    def __init__(self, state_path: str = "ml/models/refinery_state.json", threshold: float = -0.1):
        self.state_path = Path(state_path)
        self.threshold = threshold
        self.model = None
        self.clean_history = []
        self.refit_interval = 200
        self.feature_names = [
            "solar_wind_speed", "solar_wind_density", "imf_bx", "imf_by", 
            "imf_bz", "imf_bt", "electric_ey", "newell_coupling", 
            "epsilon_coupling", "kp_index", "dst_index"
        ]
        self._load_state()

    def _load_state(self):
        if self.state_path.exists():
            try:
                # In a real scenario, we might serialize the model. 
                # For now, we store the clean samples to refit.
                data = json.loads(self.state_path.read_text())
                self.clean_history = data.get("clean_history", [])
                if self.clean_history:
                    self._refit()
            except Exception:
                self.clean_history = []

    def _save_state(self):
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "clean_history": self.clean_history[-1000:] # Keep last 1000 for refitting
        }
        self.state_path.write_text(json.dumps(data))

    def _refit(self):
        if len(self.clean_history) < 100:
            return
        X = np.array(self.clean_history)
        self.model = IsolationForest(contamination='auto', random_state=42)
        self.model.fit(X)

    def is_anomaly(self, point: Dict[str, Any]) -> bool:
        if self.model is None:
            # Not enough data yet
            self._add_to_history(point)
            return False
        
        X = np.array([self._extract_features(point)])
        score = self.model.decision_function(X)[0]
        
        is_anom = score < self.threshold
        if not is_anom:
            self._add_to_history(point)
            
        return is_anom

    def _add_to_history(self, point: Dict[str, Any]):
        features = self._extract_features(point)
        self.clean_history.append(features)
        
        if len(self.clean_history) % self.refit_interval == 0:
            self._refit()
            self._save_state()

    def _extract_features(self, point: Dict[str, Any]) -> List[float]:
        sw = point.get("solarWind", {})
        b = point.get("magneticField", {})
        e = point.get("electricField", {})
        c = point.get("coupling", {})
        i = point.get("indices", {})
        
        return [
            float(sw.get("speed", 0.0)),
            float(sw.get("density", 0.0)),
            float(b.get("x", 0.0)),
            float(b.get("y", 0.0)),
            float(b.get("z", 0.0)),
            float(b.get("bt", 0.0)),
            float(e.get("ey", 0.0)),
            float(c.get("newell", 0.0)),
            float(c.get("epsilon", 0.0)),
            float(i.get("kp", 0.0)),
            float(i.get("dst", 0.0)),
        ]
