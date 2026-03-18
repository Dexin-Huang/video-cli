# Fifty Mathematical Video Retrieval Architectures

## North Star

Make a video feel like a codebase to an LLM: searchable, inspectable, citeable, and fast to drill into.

The goal is not to make a model understand a raw 40-minute video in one giant pass. The goal is to ingest once, keep grounded local evidence, and let any LLM query that evidence quickly enough to understand the video end to end through tool use.

Every idea below should be judged against that north star:

- Does it help an LLM search the video quickly?
- Does it preserve evidence with timestamps, frames, or clips?
- Does it support zooming from whole-video structure down to exact moments?
- Does it stay cheap enough to use by default?

## Purpose

This catalog was generated from multiple parallel agent passes across disjoint theory families, then curated down to 50 distinct architectures.

The bar here is not "another index with different labels." Each option is anchored in a different mathematical object, inference rule, or optimization target.

## Standout Ideas

These are the ideas that feel most interesting, either because they are unusually strong or because they open a genuinely different product direction.

- `Wavelet Event Tree`: probably the best signal-processing idea for long videos because it handles both brief bursts and slow narrative drift.
- `Koopman Scene Operator`: compelling if you want to reason about where a video segment is going, not just what it contains now.
- `Gromov-Wasserstein Timeline Matcher`: strong for "same structure, different surface appearance" retrieval.
- `Metric Sheaf Consistency Search`: unusual and promising for enforcing agreement across transcript, OCR, objects, and neighboring windows.
- `Temporal Logic Index`: one of the cleanest exact-reasoning approaches for ordered queries.
- `Bayesian Query Planner`: attractive if the CLI should actively decide which expensive inspection step to run next.
- `Low-Rank Plus Sparse Foreground`: very practical and mathematically clean for separating persistent scenes from salient deviations.
- `Submodular Evidence Set Cover`: strong answer-packaging idea because it optimizes a small diverse evidence set instead of many redundant hits.
- `Persistent Homology Event Index`: very radical, probably research-heavy, but genuinely different from standard retrieval.
- `Minimum Description Length Video Index`: elegant if you want the system to prefer compressible, reusable structure.

## North-Star Top 10

These are the 10 ideas most aligned with the actual product goal: let any LLM inspect a long video quickly, stay grounded in local evidence, and drill from overview to exact moments without paying full-video cost on every question.

These are not 10 mutually exclusive end-to-end products. Several are stack components that combine well.

Scoring:

- `Speed`: ingest and query-time efficiency
- `Grounding`: how well the method preserves inspectable evidence
- `Agent UX`: how naturally an LLM can use it through tool calls
- `Buildability`: how realistic it is as a first serious implementation

| Rank | Architecture | Speed | Grounding | Agent UX | Buildability | Why It Made The Cut |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `Change-Point Posterior Tape` | 5 | 4 | 4 | 5 | Strong segmentation backbone for long videos; cheap, interpretable, and useful before richer semantics exist. |
| 2 | `Temporal Logic Index` | 4 | 5 | 5 | 4 | Very clean way to answer ordered questions like before/after/during while staying grounded in timestamped predicates. |
| 3 | `Bayesian Query Planner` | 4 | 4 | 5 | 4 | Turns the CLI into an active inspector that spends expensive work only where uncertainty remains. |
| 4 | `Wavelet Event Tree` | 4 | 4 | 4 | 4 | One of the best multiscale ideas for long videos because it supports both coarse navigation and exact event descent. |
| 5 | `Submodular Evidence Set Cover` | 5 | 5 | 5 | 4 | Optimizes the actual answer artifact: a small, diverse evidence bundle an LLM can cite confidently. |
| 6 | `Low-Rank Plus Sparse Foreground` | 4 | 4 | 3 | 4 | Practical way to split persistent scene structure from salient deviations, which is valuable for long-form footage. |
| 7 | `Dominating Set Watchpoints` | 5 | 3 | 4 | 5 | Excellent sparse navigation primitive for agent workflows; lets the model inspect a long video through representative watchpoints. |
| 8 | `CUSUM Regime Detector` | 5 | 3 | 4 | 5 | Very fast detector for meaningful mode shifts; useful as a lightweight first-pass change index. |
| 9 | `Bayes Scene Lattice` | 3 | 4 | 3 | 3 | Good temporal smoothing layer when noisy evidence needs to cohere into stable scene states. |
| 10 | `Nystrom Landmark Kernel Map` | 4 | 3 | 4 | 4 | Probably the most practical nonlinear similarity layer here if you want a local-friendly approximation instead of a huge index. |

## Prototype Cut

If the goal is to stop ideating and start building, these are the three prototype directions that best fit the north star.

### A. Fast Local Inspection Stack

- `Change-Point Posterior Tape`
- `Temporal Logic Index`
- `Dominating Set Watchpoints`
- `Submodular Evidence Set Cover`

Why:
This is the most direct path to "video as codebase." It gives segmentation, exact temporal querying, sparse navigation, and compact evidence bundles.

### B. Adaptive Multiscale Stack

- `Wavelet Event Tree`
- `Bayesian Query Planner`
- `Low-Rank Plus Sparse Foreground`
- `Submodular Evidence Set Cover`

Why:
This is the most agent-native design. It supports coarse-to-fine inspection, selective expensive refinement, and answer packaging without over-indexing everything upfront.

### C. Smoothed Retrieval Stack

- `Change-Point Posterior Tape`
- `Bayes Scene Lattice`
- `Temporal Logic Index`
- `Nystrom Landmark Kernel Map`

Why:
This is the safest path if raw detectors are noisy and you want a more stable retrieval layer before the agent reasons over results.

## Signal Processing, Control, And Dynamical Systems

### 1. Wavelet Event Tree

Mathematics: `W_x(a,b) = int x(t) psi_{a,b}(t) dt`, with multiscale energy `E(a,b) = |W_x(a,b)|^2`.

Ingest: Build wavelet pyramids over motion, OCR density, audio power, and scene-change traces.

Query: Match cues at coarse and fine scales, then descend into precise windows.

Why distinct: One representation handles very short events and very long narrative structure.

### 2. Dynamic Time Warping Motif Search

Mathematics: `DTW(i,j) = d(i,j) + min(DTW(i-1,j), DTW(i,j-1), DTW(i-1,j-1))`.

Ingest: Convert each interval into a multichannel cue sequence.

Query: Search for warped matches to patterns like "build-up then reveal then applause."

Why distinct: Preserves order while tolerating timing variation.

### 3. Koopman Scene Operator

Mathematics: Learn linear evolution over observables, `g(x_{t+1}) approx K g(x_t)`.

Ingest: Build observables from objects, OCR, motion, and audio, then fit `K`.

Query: Retrieve segments whose future dynamics match a desired storyline.

Why distinct: Retrieves by evolution law rather than snapshot similarity.

### 4. Recurrence Plot Memory

Mathematics: `R_ij = 1[||x_i - x_j|| < epsilon]`.

Ingest: Build state vectors per window and store recurrence plots and recurrence-quantification metrics.

Query: Search for repeated regimes, loops, and returns.

Why distinct: Directly indexes repetition structure inside long videos.

### 5. Cross-Spectral Coherence Retriever

Mathematics: `C_xy(f) = |S_xy(f)|^2 / (S_xx(f) S_yy(f))`.

Ingest: Turn motion, shot changes, OCR bursts, and audio into synchronized time series.

Query: Retrieve windows where channels co-vary in characteristic ways.

Why distinct: Searches coordinated multimodal behavior rather than content identity.

### 6. Particle Filter Hypothesis Tracker

Mathematics: `p(z_t | x_{1:t}) approx sum_i w_t^(i) delta(z_t - z_t^(i))`.

Ingest: Define latent hypotheses such as "warning state active" and update them from noisy cues.

Query: Return intervals with high posterior mass for complex nonlinear states.

Why distinct: Handles nonlinear, non-Gaussian evidence better than simple smoothing.

### 7. CUSUM Regime Detector

Mathematics: `S_t = max(0, S_{t-1} + ell_t - k)`.

Ingest: Compute per-window likelihood ratios over multimodal feature changes.

Query: Retrieve the strongest sustained regime shifts and their neighborhoods.

Why distinct: Optimized for "when does the mode change?" instead of semantic similarity.

### 8. Attractor Basin Matcher

Mathematics: Reconstruct phase space `X_t = [x_t, x_{t-tau}, ..., x_{t-(m-1)tau}]`.

Ingest: Form phase portraits from motion, audio, and topic traces.

Query: Match clips by dynamic shape such as settling, oscillation, or chaotic bursts.

Why distinct: Captures style of evolution, not literal visual identity.

### 9. Reachability Query Controller

Mathematics: `x_{t+1} = A x_t + B u_t`, with objective `min sum ||u_t||` to reach a target evidence set.

Ingest: Fit local transition models between scene or UI states.

Query: Ask whether a target state can be reached from a current context, and how.

Why distinct: Treats retrieval as reachability in a controlled dynamical system.

### 10. Innovation Spike Index

Mathematics: Forecast residual `e_t = x_t - x_hat_{t|t-1}` from AR, VAR, or state-space models.

Ingest: Fit predictors to multimodal streams and store innovation magnitude and direction.

Query: Retrieve unusual deviations or deviations matching a query profile.

Why distinct: Highlights surprise relative to local expectation.

## Geometry, Topology, And Metric-Space Ideas

### 11. Wasserstein Scene Flow

Mathematics: `W_p(mu_q, mu_t) = inf_{gamma in Pi(mu_q, mu_t)} int d(x,y)^p d gamma`.

Ingest: Represent each window as an empirical measure over frames, objects, OCR, and audio cues.

Query: Compute optimal transport to shortlist windows, then inspect the transport plan.

Why distinct: Compares whole scene composition rather than one pooled vector.

### 12. Gromov-Wasserstein Timeline Matcher

Mathematics: `GW(C_q, C_t) = min_T sum |C_q(i,j) - C_t(k,l)|^2 T_ik T_jl`.

Ingest: Build intra-window distance matrices over objects, regions, and frames.

Query: Match windows by relational geometry even when raw features live in different spaces.

Why distinct: Finds structural analogies across different domains or styles.

### 13. Persistent Homology Event Index

Mathematics: Compute persistence diagrams from Vietoris-Rips filtrations and compare via bottleneck or Wasserstein distance.

Ingest: Build point clouds from motion trajectories, object tracks, or multimodal window features.

Query: Retrieve windows with similar topological signatures such as loops, merges, or recurring motifs.

Why distinct: Searches topology of evolution rather than semantics or appearance.

### 14. Mapper Video Atlas

Mathematics: Use a filter `f : X -> R^k`, cluster preimages, and connect overlapping clusters into a Mapper graph.

Ingest: Extract window features and build a topological atlas over the corpus.

Query: Locate a query in the atlas and traverse adjacent regions for context.

Why distinct: Makes global video structure navigable instead of flat.

### 15. Geodesic Story Manifold

Mathematics: Learn a manifold `M` with geodesic distance `d_M(x,y)` using Isomap or Laplacian eigenmaps.

Ingest: Build a neighborhood graph over windows and recover manifold coordinates.

Query: Retrieve by geodesic proximity and follow manifold paths through the story.

Why distinct: Preserves gradual long-range continuity better than Euclidean search.

### 16. Ricci-Flow State Graph

Mathematics: Use Ollivier-Ricci curvature `kappa(x,y) = 1 - W_1(m_x, m_y) / d(x,y)`.

Ingest: Build a transition graph over shots or recurring screen states and compute curvature.

Query: Prioritize negatively curved bottlenecks and branching regions.

Why distinct: Surfaces structurally important transitions, not just frequent states.

### 17. Barycentric Prototype Memory

Mathematics: `nu* = argmin_nu sum_i lambda_i W_2^2(nu, mu_i)`.

Ingest: Cluster windows and compute Wasserstein barycenters as prototypes.

Query: Route queries to nearest prototype, then refine inside the cluster.

Why distinct: Compresses multimodal scene structure without collapsing to simple means.

### 18. Metric Sheaf Consistency Search

Mathematics: Minimize gluing inconsistency `sum ||r_UV(s_U) - s_V||^2` across overlapping local sections.

Ingest: Build overlapping local descriptions from transcript, OCR, objects, and motion.

Query: Find spans where local evidence assembles into a globally consistent answer.

Why distinct: Explicitly reasons about cross-window and cross-modality agreement.

### 19. Curvature-Aware Trajectory Retrieval

Mathematics: Compare paths `gamma(t)` on a manifold using an elastic or path energy metric `E(gamma) = int ||D_t gamma||^2 dt`.

Ingest: Track manifold trajectories of scene descriptors over time.

Query: Search for similar evolution patterns rather than similar frames.

Why distinct: Good for "the way the scene changes," not just what it contains.

### 20. Hausdorff Landmark Cover

Mathematics: Choose landmarks `L` minimizing `max_x min_{l in L} d(x,l)` and compare sets with Hausdorff distance `d_H(A,B)`.

Ingest: Select representative landmark windows and assign all windows to local cells.

Query: Route through landmark cover, then inspect only local neighborhoods.

Why distinct: Gives geometric coverage guarantees for fast coarse retrieval.

## Probabilistic Models And Information Theory

### 21. Bayes Scene Lattice

Mathematics: `p(z_{1:T} | x_{1:T}) proportional to p(z_1) prod_t p(z_t | z_{t-1}) prod_t p(x_t | z_t)`.

Ingest: Extract multimodal features per window and fit an HMM or switching linear dynamical system.

Query: Map the user query to a state likelihood and run forward-backward or Viterbi.

Why distinct: Smooths noisy evidence into coherent latent scene regimes.

### 22. Change-Point Posterior Tape

Mathematics: `min_tau sum_k L(x_{tau_{k-1}:tau_k}) + beta K`.

Ingest: Run Bayesian online change-point detection or penalized segmentation over multimodal streams.

Query: Search segments between inferred boundaries and refine near high-posterior changes.

Why distinct: Centers retrieval around regime boundaries and segmentation uncertainty.

### 23. Information Bottleneck Storyline

Mathematics: `min I(X;Z) - beta I(Z;Y)`.

Ingest: Learn segment codes that compress raw evidence while preserving downstream retrieval utility.

Query: Retrieve via bottleneck codes, then expand to raw windows.

Why distinct: Makes compression versus relevance an explicit objective.

### 24. Factor Graph Evidence Fusion

Mathematics: `p(z | x) proportional to prod_i phi_i(z_i) prod_(i,j) psi_ij(z_i,z_j)`.

Ingest: Emit noisy detector outputs for text, objects, motion, scene labels, and audio events.

Query: Clamp query variables and run belief propagation to score intervals.

Why distinct: Explicit compositional uncertainty handling across modalities.

### 25. Dirichlet Process Scene Discovery

Mathematics: Chinese Restaurant Process prior with `P(z_{n+1}=k) proportional to n_k` for old clusters and `alpha` for a new one.

Ingest: Cluster segments with a DP-GMM, HDP-HMM, or related nonparametric model.

Query: Search discovered scene families by prototype evidence.

Why distinct: Lets the number of scene types emerge from the data.

### 26. Surprisal Heatmap Retriever

Mathematics: `s_t = -log p(x_t | x_{<t})`.

Ingest: Train or reuse predictive models over multimodal streams and store surprisal traces.

Query: Bias retrieval toward unusual windows, then filter semantically.

Why distinct: Salience comes from predictive surprise rather than labels.

### 27. Mutual Information Span Selector

Mathematics: `S* = argmax_S I(X_S;Q) - lambda |S|`.

Ingest: Estimate mutual information between segment features and query archetypes.

Query: Retrieve a sparse set of spans with high information about the query family.

Why distinct: Sparse retrieval is driven by information gain, not distance.

### 28. Bayesian Query Planner

Mathematics: `a* = argmax_a E[IG(I; o_a)]`.

Ingest: Keep only a sparse baseline index.

Query: Choose the next expensive inspection action by expected information gain.

Why distinct: Turns query-time refinement into explicit decision-theoretic planning.

### 29. Hidden Semi-Markov Event Parser

Mathematics: `p(z_{1:K}, d_{1:K}, x_{1:T}) = prod_k p(z_k | z_{k-1}) p(d_k | z_k) prod_{t in k} p(x_t | z_k)`.

Ingest: Fit duration-aware event models over multimodal features.

Query: Retrieve event intervals subject to latent type and duration constraints.

Why distinct: Handles event duration explicitly rather than assuming memoryless transitions.

### 30. Minimum Description Length Video Index

Mathematics: Minimize `L(M) + L(D | M)`.

Ingest: Compare candidate segmentations and symbolic representations by compression cost.

Query: Search using the representation that best captures repeated structure and deviations.

Why distinct: Favors reusable structure and penalizes gratuitous complexity.

## Graph Theory, Logic, And Discrete Methods

### 31. Temporal Logic Index

Mathematics: Evaluate LTL or MTL formulas such as `F(screen_error) and G not crash U retry`.

Ingest: Extract timestamped predicates from OCR, objects, transcript, and audio.

Query: Compile the user request into temporal logic and run model checking.

Why distinct: Exact reasoning over order, inevitability, and temporal conditions.

### 32. Interval SAT Retriever

Mathematics: Solve SAT or SMT constraints such as `(A before B) and (C overlaps A) and not D`.

Ingest: Build discrete interval facts from transcript, OCR, shots, and detectors.

Query: Compile prompt constraints and enumerate satisfying windows.

Why distinct: Exact symbolic retrieval for compositional interval queries.

### 33. Max-Cover Evidence Picker

Mathematics: `f(S) = |union_{i in S} cues_i| - lambda |S|`.

Ingest: Assign each segment a set of cues, entities, and events.

Query: Select a small evidence set covering the most query-relevant cues.

Why distinct: Optimizes evidence bundles rather than only ranking clips.

### 34. Steiner Query Graph

Mathematics: Find a minimum-cost Steiner tree `min sum_{e in T} w_e` connecting required query nodes.

Ingest: Build a temporal scene graph over entities, shots, OCR tokens, and transitions.

Query: Connect multi-hop concepts such as person, whiteboard, chart, and warning banner.

Why distinct: Good for queries whose evidence is distributed across a graph.

### 35. Min-Cost Flow Timeline Search

Mathematics: Send flow through an interval DAG minimizing `sum c_e x_e` under continuity and order constraints.

Ingest: Create interval DAGs with edge costs derived from evidence scores.

Query: Recover the best coherent path for a multi-stage story.

Why distinct: Returns a consistent storyline, not isolated hits.

### 36. Hypergraph Co-Occurrence Engine

Mathematics: Score hyperedges by `score(E,q) = sum_{v in E intersect q} w_v`.

Ingest: Build hyperedges for shots or windows containing higher-order co-occurrences.

Query: Search combinations like speaker + slide + applause.

Why distinct: Captures multi-way interactions better than pairwise graphs.

### 37. Subgraph Isomorphism Retriever

Mathematics: Find embeddings of a query graph `Q` inside a video graph `G`.

Ingest: Represent windows as labeled graphs of entities, relations, and events.

Query: Compile a relational prompt into `Q` and run subgraph matching.

Why distinct: Exact structural matching for relational video questions.

### 38. Dominating Set Watchpoints

Mathematics: Choose the smallest set `D` such that every node is in `D` or adjacent to `D`.

Ingest: Build an adjacency graph over similar or neighboring shots.

Query: Inspect watchpoints first, then expand locally.

Why distinct: Produces a mathematically sparse navigation index for long videos.

### 39. Topological Order Change Engine

Mathematics: Minimize order violations in a DAG, `min sum 1[(u -> v) violated]`.

Ingest: Infer precedence edges from transitions and evidence.

Query: Search for episodes matching partial orders such as pricing before demo before Q&A.

Why distinct: Handles order-aware retrieval without demanding exact timestamps everywhere.

### 40. Branch-and-Bound Set Packager

Mathematics: `max sum u_i x_i` subject to interval packing and non-overlap constraints.

Ingest: Score candidate windows and build a conflict graph over overlaps.

Query: Pack the best nonredundant clips, frames, or intervals for a query.

Why distinct: Optimizes compact, diverse result sets rather than cluttered rankings.

## Optimization, Sparse Recovery, Factorization, And Kernels

### 41. Compressive Event Recovery

Mathematics: `min_x ||x||_1` subject to `||A x - y||_2 <= epsilon`.

Ingest: Build a sensing matrix from multimodal measurements such as motion, OCR, and audio.

Query: Recover sparse relevant-event times from a query-derived measurement vector.

Why distinct: Assumes relevant moments are sparse spikes in time.

### 42. NMF Scene Basis

Mathematics: Factor `X approx W H` with `W, H >= 0`.

Ingest: Build nonnegative segment features from OCR, objects, audio events, and topics.

Query: Project query constraints into basis space and rank windows by basis coefficients.

Why distinct: Produces additive, interpretable scene ingredients.

### 43. CP Tensor Memory

Mathematics: `X_{t,m,f} approx sum_{r=1}^R a_r otimes b_r otimes c_r`.

Ingest: Form a tensor over time, modality, and feature, then fit a CP decomposition.

Query: Match queries to latent factors and retrieve high-loading time indices.

Why distinct: Models interactions across time, modality, and feature explicitly.

### 44. Kernel Change Retriever

Mathematics: `MMD^2(P,Q) = ||mu_P - mu_Q||_H^2`.

Ingest: Compute kernel embeddings for neighboring windows over OCR strings, objects, and audio events.

Query: Retrieve distributional changes that match transition-like prompts.

Why distinct: Searches change in distribution rather than similarity of content.

### 45. UCB Inspection Planner

Mathematics: `a_t = argmax_a mu_hat_a + alpha sqrt(log t / n_a)`.

Ingest: Maintain only a sparse baseline index and a set of possible refinement actions.

Query: Allocate expensive work such as OCR, dense frames, tracking, or cloud QA as a bandit problem.

Why distinct: Compute budget is optimized online instead of fixed in advance.

### 46. Low-Rank Plus Sparse Foreground

Mathematics: `min_{L,S} ||L||_* + lambda ||S||_1` subject to `X = L + S`.

Ingest: Stack descriptors over time and split persistent structure from sparse anomalies.

Query: Search sparse residuals for salient events or low-rank components for persistent scenes.

Why distinct: Separates background regularity from meaningful deviations.

### 47. Matrix Completion Evidence Grid

Mathematics: `min_M ||M||_*` subject to observed entries matching the evidence grid.

Ingest: Store sparse multimodal observations over a time-by-modality matrix.

Query: Fill likely missing evidence before ranking intervals for complex prompts.

Why distinct: Uses low-rank structure to reason about partially observed evidence.

### 48. Submodular Evidence Set Cover

Mathematics: `F(S) = sum_q w_q min(1, sum_{i in S} c_iq) - lambda |S|`.

Ingest: Estimate how much each segment covers different query archetypes.

Query: Return a small set of clips that jointly explains the user request.

Why distinct: Optimizes diverse explanatory coverage, not single best-match ranking.

### 49. Nystrom Landmark Kernel Map

Mathematics: `K approx C W^dagger C^T`.

Ingest: Choose representative landmark clips and compute multimodal kernels to them.

Query: Compare prompts and candidate windows in a low-rank kernel space.

Why distinct: Keeps rich nonlinear similarity while staying light enough for local use.

### 50. Bilevel Query Adapter

Mathematics: `min_theta L_query(x*(theta))`, where `x*(theta) = argmin_x f(x, theta)`.

Ingest: Learn a lower-level segment scorer and an upper-level query calibrator over retrieval tasks.

Query: Adapt weights for OCR, motion, objects, and audio depending on the query type.

Why distinct: Query understanding becomes an optimization problem over the retrieval system itself.

## Practical Read

If the goal is "start building against the north star," begin with Prototype A or Prototype B from the shortlist above.

If the goal is "fast and weird but maybe buildable," the strongest ingredient set is:

- `Wavelet Event Tree`
- `Change-Point Posterior Tape`
- `Temporal Logic Index`
- `Bayesian Query Planner`
- `Low-Rank Plus Sparse Foreground`
- `Submodular Evidence Set Cover`

If the goal is "most radical research directions," the sharpest short-list is:

- `Koopman Scene Operator`
- `Gromov-Wasserstein Timeline Matcher`
- `Persistent Homology Event Index`
- `Metric Sheaf Consistency Search`
- `Reachability Query Controller`
- `Minimum Description Length Video Index`
