import json
import argparse
import sys
from pathlib import Path
from typing import List, Dict, Any
from datetime import datetime
from isolation_forest_detector import IsolationForestDetector
from iqr_filter import IQRFilter

class DataRefinery:
    def __init__(self):
        self.iso_forest = IsolationForestDetector()
        self.iqr = IQRFilter()
        self.last_timestamp = None
        self.features = [
            "solar_wind_speed", "solar_wind_density", "imf_bx", "imf_by", 
            "imf_bz", "imf_bt", "electric_ey", "newell_coupling", 
            "epsilon_coupling", "kp_index", "dst_index"
        ]

    def validate_schema(self, point: Dict[str, Any]) -> bool:
        # Stage 1: Schema & Physical Plausibility
        required = ["timestamp", "solarWind", "magneticField", "indices"]
        for field in required:
            if field not in point or point[field] is None:
                return False
        
        # Timestamp checks
        try:
            ts = point["timestamp"]
            # Basic ISO format check or similar
            # For simplicity, we just check if it's a string and if it's increasing
            if self.last_timestamp and ts <= self.last_timestamp:
                return False
            self.last_timestamp = ts
        except Exception:
            return False

        # Physical plausibility
        sw = point.get("solarWind", {})
        speed = sw.get("speed", 0)
        if not (200 <= speed <= 2000):
            return False
        
        bz = point.get("magneticField", {}).get("z", 0)
        if not (-100 <= bz <= 100):
            return False
            
        kp = point.get("indices", {}).get("kp", 0)
        if not (0 <= kp <= 9):
            return False
            
        return True

    def refine(self, point: Dict[str, Any]) -> (Dict[str, Any], bool):
        # Stage 1
        if not self.validate_schema(point):
            return point, False
        
        # Stage 2: Isolation Forest
        if self.iso_forest.is_anomaly(point):
            return point, False
            
        # Stage 3: Rolling IQR
        refined_point = self.iqr.filter_point(point, self.features)
        
        # If any feature is flagged for interpolation, we might handle it here 
        # or let the builder handle it. The plan says "replaced with weighted 
        # linear interpolation rather than dropped". 
        # For now, we flag it.
        
        return refined_point, True

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Input JSON raw data")
    parser.add_argument("--output", required=True, help="Output clean JSONL")
    parser.add_argument("--quarantine", required=True, help="Output quarantine JSONL")
    parser.add_argument("--dry-run", action="store_true", help="Dry run only")
    args = parser.parse_args()

    refinery = DataRefinery()
    
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: {args.input} not found")
        sys.exit(1)
        
    try:
        data = json.loads(input_path.read_text())
        points = data.get("points", [])
    except Exception as e:
        print(f"Error parsing input: {e}")
        sys.exit(1)

    clean_points = []
    quarantine_points = []

    for p in points:
        refined, is_clean = refinery.refine(p)
        if is_clean:
            clean_points.append(refined)
        else:
            quarantine_points.append(p)

    if not args.dry_run:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        with open(args.output, "w") as f:
            for p in clean_points:
                f.write(json.dumps(p) + "\n")
                
        Path(args.quarantine).parent.mkdir(parents=True, exist_ok=True)
        with open(args.quarantine, "w") as f:
            for p in quarantine_points:
                f.write(json.dumps(p) + "\n")
                
        print(f"Refinery complete. Clean: {len(clean_points)}, Quarantined: {len(quarantine_points)}")
    else:
        print(f"[DRY RUN] Would process {len(points)} points. Clean: {len(clean_points)}, Quarantined: {len(quarantine_points)}")

if __name__ == "__main__":
    main()
