# Technical Report: On-Orbit Intelligence—Hardware Architectures and Neural Network Optimization for Spaceborne Edge Computing

# 1\. The Paradigm Shift: From Backhaul Contention to Autonomous Edge Intelligence

The aerospace industry is currently executing a strategic pivot from legacy "bent-pipe" satellite architectures toward integrated on-orbit edge intelligence. This transition is not merely a preference but a structural necessity driven by severe backhaul contention. NASA’s EOSDIS archive provides a stark metric for this crisis: the volume grew from 41.86 PB to 59.24 PB in a single fiscal year. Attempting to downlink this exponential surge in Earth observation (EO) data creates an insurmountable bottleneck, where sensor capability far outstrips available RF bandwidth.For mission architects, the "So What?" of edge computing is defined by the compression of the decision loop. Ground-based analysis typically imposes multi-day latencies, which are unacceptable for time-critical operations. On-orbit processing has already demonstrated the ability to sequence DNA in 6 minutes—a task that previously required 12.2 hours—and identify critical astronaut glove damage in seconds rather than the five days required for ground-based image review. These operational drivers—latency reduction, bandwidth conservation, and deep-space self-sufficiency—mandate the integration of high-performance compute directly into the spacecraft bus. However, as we move toward these intelligent nodes, architects must reconcile the aggressive compute requirements with the unique hazards of the space environment, including Total Ionizing Dose (TID) and Single Event Upsets (SEU).

# 2\. Comparative Analysis of Spaceborne Edge Processing Hardware

Selecting an edge processor requires a rigorous evaluation of the trade-off between raw throughput (TOPS) and deterministic reliability. While space-qualified VPUs and FPGAs offer high radiation tolerance, the modern trend involves the deployment of high-performance "Commercial Off-The-Shelf" (COTS) components in "Solar-Aware" configurations. The current frontier is defined by the Jetson Orin NX, providing 157 TOPS, yet its high power draw and susceptibility to latch-up risks in high-radiation orbits require sophisticated mitigation strategies.

## Hardware Benchmark Comparison

Processor Name,Architecture Type,Compute (TOPS),Power (W),Memory Config,Qualification / Status  
Myriad 2,VPU,\~1 TOPS,\~1 W,512 MB LPDDR3,Space-qualified ✓  
Coral Edge,TPU,4 TOPS,\~2 W,\~8 MB SRAM,COTS ∘  
Jetson Orin Nano,GPU,67 TOPS,7–15 W,8 GB LPDDR5,COTS ∘  
Jetson Orin NX,GPU (Current Frontier),157 TOPS,10–25 W,16 GB LPDDR5,COTS ∘  
Jetson AGX Xavier,GPU,22 TOPS,10–30 W,64 GB LPDDR4x,COTS ∘  
XQR Versal VE2102,Hybrid / Adaptive,\~8 TOPS,\~10 W,64 GB DDR4,Space-qualified ✓  
Qualcomm RB5,SoC / AI Engine,15 TOPS,6–15 W,16 GB LPDDR5,No rad info ✗ (High risk)  
Spaceborne Computer-2,HPC (Myriad X/Snapdragon 855),Variable,Variable,130 TB SSD,Flight Proven (ISS) ✓  
From an architectural standpoint, raw TOPS are a deceptive metric if not coupled with memory bandwidth. For instance, while the Jetson AGX Xavier provides a robust 64 GB of memory, it still cannot natively accommodate the 140 GB weight-set of a 70B parameter model without the aggressive quantization techniques discussed in Section 4\. Furthermore, the Qualcomm RB5's lack of radiation data renders it a significant risk for Geostationary (GEO) missions compared to Low Earth Orbit (LEO) environments where the magnetosphere provides a degree of shielding against TID.

# 3\. System-Level Design: SWaP Constraints by Spacecraft Size Class

The "Size, Weight, and Power" (SWaP) envelope is the primary constraint on AI model complexity. Architects must prioritize model efficiency to ensure thermal stability and avoid hardware throttling in a vacuum.

* **Picosatellites (0.01–1 kg):**  Limited to sub-watt power envelopes. These platforms must utilize ultra-lightweight models (\<1M parameters) and high-efficiency silicon like the Myriad 2\.  
* **Nanosatellites (e.g., 6U CubeSats):**  Typically operate on an 18.5 W solar average. System designers must allocate a maximum 10 W budget for AI compute, which must include the thermal overhead required for passive heat dissipation. This tier supports medium-scale Foundation Models (\~500M parameters) on hardware like the Jetson Orin Nano.  
* **Medium-to-Large Satellites (e.g., GEO/Axiom Station):**  These platforms allow for High-Performance Computing (HPC) nodes and multi-billion parameter Vision Language Models (VLMs). Relaxed SWaP constraints enable active cooling solutions, allowing for sustained high-TOPS operations.Architects are cautioned that even on larger platforms, the 140 GB memory requirement for state-of-the-art models (Source 6\) remains the primary bottleneck, necessitating a "Software-First" approach to model deployment.

# 4\. AI and Neural Network Optimization for the Extreme Edge

Model compression is a mission-critical requirement for spaceborne edge computing. Because a 70B parameter model requires 140 GB of memory for weights—far exceeding the 16 GB–64 GB capacity of modern edge GPUs—architects must implement the following optimization taxonomy:

* **Quantization:**  Reducing weights from FP32/FP16 to INT8 or INT4. By using lookup tables, we minimize on-chip memory footprints, making large models compatible with the 16 GB memory of the Orin NX.  
* **Pruning (RemoteTrimmer):**  Structural and channel-wise pruning remove redundant neurons. For Synthetic Aperture Radar (SAR) data, architects must utilize the "RemoteTrimmer" technique. SAR imagery is highly phase-sensitive; standard pruning often destroys the high-frequency components essential for SAR texture analysis. RemoteTrimmer is specifically designed to preserve these features.  
* **Knowledge Distillation:**  A "Teacher-Student" framework compresses high-parameter models into high-efficiency Deep Convolutional Neural Networks (DCNNs). This is vital for continuous volcanic or cloud monitoring, where models must fit within a strict 5 MB hardware footprint.  
* **Parameter-Efficient Fine-Tuning (PEFT):**  Utilizing LoRA/QLoRA for in-orbit adaptation. This enables "parameter-only" uplinks, allowing ground teams to update model logic without the massive bandwidth cost of a full model refresh.

# 5\. Edge Deployment Workflows and Spaceborne Reliability

The "Model-to-Orbit" pipeline requires hardware-specific compilation to ensure low-latency execution and power efficiency.

##### Compilation Pathways

1. **Intel/VPU Track:**  PyTorch → ONNX → OpenVINO (.xml/.bin) → .unn CVAI format.  
2. **NVIDIA/GPU Track:**  PyTorch → TensorRT optimization tailored for Jetson modules.

##### Solar-Aware Scheduling and SoH Management

To maximize hardware longevity, architects should replace terrestrial "Carbon-Aware Scheduling" with  **Solar-Aware and Thermal-Aware Scheduling** . By shifting non-critical AI workloads to periods of peak solar generation or optimal thermal cycles, we can mitigate the risk of SEUs and latch-up events. Implementing robust "State-of-Health" (SoH) monitoring for COTS hardware, as seen in the HPE SBC-2 experiments, can extend hardware operational life by approximately 1.6 years. This longevity is achieved by actively managing the hardware's duty cycle in response to real-time radiation and thermal telemetry.

# 6\. Conclusion: The Architect’s Outlook for Self-Sovereign Satellites

The convergence of 150+ TOPS edge hardware and advanced neural network pruning has initiated the era of the self-sovereign satellite. By treating the spacecraft as a grid-responsive, intelligent node rather than a simple sensor, we resolve the crisis of backhaul contention and enable deep-space autonomy. The future of on-orbit intelligence lies in the tight coupling of "Solar-Aware" hardware scheduling with parameter-efficient model updates, ensuring that our presence in the cosmos is both enduring and increasingly autonomous.  
