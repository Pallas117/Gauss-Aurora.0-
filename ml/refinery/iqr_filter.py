import numpy as np
from typing import List, Dict, Any

class IQRFilter:
    def __init__(self, window_size: int = 60, threshold: float = 3.0):
        self.window_size = window_size
        self.threshold = threshold
        self.history = {}

    def filter_point(self, point: Dict[str, Any], features: List[str]) -> Dict[str, Any]:
        """
        Applies rolling IQR filter. Points > threshold * IQR from median 
        are flagged as 'interpolation_candidate'.
        """
        point_features = self._extract_features(point)
        result = point.copy()
        result["flags"] = result.get("flags", [])
        
        for feature in features:
            val = point_features.get(feature)
            if val is None:
                continue
            
            if feature not in self.history:
                self.history[feature] = []
            
            self.history[feature].append(val)
            if len(self.history[feature]) > self.window_size:
                self.history[feature].pop(0)
            
            if len(self.history[feature]) >= self.window_size:
                data = np.array(self.history[feature])
                q1, q3 = np.percentile(data, [25, 75])
                iqr = q3 - q1
                median = np.median(data)
                
                lower_bound = median - self.threshold * iqr
                upper_bound = median + self.threshold * iqr
                
                if val < lower_bound or val > upper_bound:
                    result["flags"].append(f"interpolation_candidate:{feature}")
                    
        return result

    def _extract_features(self, point: Dict[str, Any]) -> Dict[str, float]:
        sw = point.get("solarWind", {})
        b = point.get("magneticField", {})
        e = point.get("electricField", {})
        c = point.get("coupling", {})
        i = point.get("indices", {})
        
        return {
            "solar_wind_speed": float(sw.get("speed", 0.0)),
            "solar_wind_density": float(sw.get("density", 0.0)),
            "imf_bx": float(b.get("x", 0.0)),
            "imf_by": float(b.get("y", 0.0)),
            "imf_bz": float(b.get("z", 0.0)),
            "imf_bt": float(b.get("bt", 0.0)),
            "electric_ey": float(e.get("ey", 0.0)),
            "newell_coupling": float(c.get("newell", 0.0)),
            "epsilon_coupling": float(c.get("epsilon", 0.0)),
            "kp_index": float(i.get("kp", 0.0)),
            "dst_index": float(i.get("dst", 0.0)),
        }
