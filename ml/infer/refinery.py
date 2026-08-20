"""Data Refinery ML Layer for inference payload validation and anomaly detection."""

import numpy as np
from typing import Dict, Any, List
from sklearn.ensemble import IsolationForest

class DataRefinery:
    def __init__(self):
        # Isolation forest for multivariate anomaly detection
        # We use a slight contamination expectation (e.g. 5% anomalies)
        self.iso_forest = IsolationForest(
            n_estimators=50, 
            contamination=0.05, 
            random_state=42
        )
        
    def _extract_features(self, step: Dict[str, Any]) -> list[float]:
        """Extracts the core feature vector (bz, speed, density, kp) from a sequence step."""
        sw = step.get("solarWind", {})
        b = step.get("magneticField", {})
        idx = step.get("indices", {})
        
        try:
            speed = float(sw.get("speed", 400.0))
            density = float(sw.get("density", 5.0))
            bz = float(b.get("z", 0.0))
            kp = float(idx.get("kp", 2.0))
        except (ValueError, TypeError):
            speed, density, bz, kp = 400.0, 5.0, 0.0, 2.0
            
        return [bz, speed, density, kp]

    def _clean_iqr(self, sequence_features: np.ndarray) -> np.ndarray:
        """Fast univariate bound checking using Interquartile Range (IQR)."""
        if len(sequence_features) < 4:
            return sequence_features  # Not enough data for IQR
            
        cleaned = np.copy(sequence_features)
        
        # Calculate IQR for each feature column (0: bz, 1: speed, 2: density, 3: kp)
        for col_idx in range(cleaned.shape[1]):
            col_data = cleaned[:, col_idx]
            q1 = np.percentile(col_data, 25)
            q3 = np.percentile(col_data, 75)
            iqr = q3 - q1
            
            # Define bounds (1.5 IQR is standard, we use 2.0 for physical telemetry to be lenient)
            lower_bound = q1 - 2.0 * iqr
            upper_bound = q3 + 2.0 * iqr
            
            # Create a mask of valid (non-anomalous) points
            valid_mask = (col_data >= lower_bound) & (col_data <= upper_bound)
            
            # Self-healing: replace outliers with the median of the valid data
            if not np.all(valid_mask):
                valid_median = np.median(col_data[valid_mask]) if np.any(valid_mask) else np.median(col_data)
                cleaned[~valid_mask, col_idx] = valid_median
                
        return cleaned

    def clean_sequence(self, sequence: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], bool, Dict[str, Any]]:
        """
        Pipes the sequence through IQR bounds and an Isolation Forest 
        to detect and heal anomalies.
        Returns: (healed_sequence, has_anomaly, anomaly_metadata)
        """
        if not sequence:
            return sequence, False, {}

        # 1. Extract raw features
        raw_features = np.array([self._extract_features(step) for step in sequence])
        
        has_anomaly = False
        anomaly_meta = {
            "iqr_healed_points": 0,
            "isolation_forest_flags": 0,
            "original_means": raw_features.mean(axis=0).tolist() if len(raw_features) > 0 else []
        }

        # 2. Fast IQR Univariate Cleaning
        iqr_cleaned_features = self._clean_iqr(raw_features)
        if not np.array_equal(raw_features, iqr_cleaned_features):
            has_anomaly = True
            diff_mask = raw_features != iqr_cleaned_features
            anomaly_meta["iqr_healed_points"] = int(np.sum(diff_mask))
            
        # 3. Multivariate Isolation Forest
        if len(iqr_cleaned_features) >= 10:  # Need minimum samples to fit forest
            # Fit on the IQR-cleaned data to detect complex multi-dimensional outliers
            self.iso_forest.fit(iqr_cleaned_features)
            preds = self.iso_forest.predict(iqr_cleaned_features) # 1 for inlier, -1 for outlier
            
            outlier_mask = preds == -1
            num_outliers = int(np.sum(outlier_mask))
            if num_outliers > 0:
                has_anomaly = True
                anomaly_meta["isolation_forest_flags"] = num_outliers
                
                # Self-healing: interpolate/replace multivariate outliers with column medians
                # of the robust inliers
                inliers = iqr_cleaned_features[~outlier_mask]
                if len(inliers) > 0:
                    robust_medians = np.median(inliers, axis=0)
                    iqr_cleaned_features[outlier_mask] = robust_medians

        # 4. Reconstruct the healed sequence
        healed_sequence = []
        for i, step in enumerate(sequence):
            step_copy = dict(step) # Shallow copy
            # Update the specific dictionaries if they existed, otherwise create them
            sw = dict(step_copy.get("solarWind", {}))
            b = dict(step_copy.get("magneticField", {}))
            idx = dict(step_copy.get("indices", {}))
            
            b["z"] = float(iqr_cleaned_features[i, 0])
            sw["speed"] = float(iqr_cleaned_features[i, 1])
            sw["density"] = float(iqr_cleaned_features[i, 2])
            idx["kp"] = float(iqr_cleaned_features[i, 3])
            
            step_copy["solarWind"] = sw
            step_copy["magneticField"] = b
            step_copy["indices"] = idx
            
            healed_sequence.append(step_copy)
            
        return healed_sequence, has_anomaly, anomaly_meta

# Global Instance
global_refinery = DataRefinery()
