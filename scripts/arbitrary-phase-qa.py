#!/usr/bin/env python3
"""Exhaust every ordered decoder-phase jump used by the Codex pet host.

This numeric engine is intentionally separate from the JavaScript red-path
tests.  NumPy's matrix products let the audit inspect every p->q topology and
intended-surface perceptual relationship without weakening the check to a
sample or an adjacent-frame proxy.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import struct
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
CELL_W, CELL_H = 192, 208
ATLAS_W, ATLAS_H = 1536, 2288
PHASES = 60
ROW_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]
CELLS = [(row, column) for row, count in enumerate(ROW_COUNTS) for column in range(count)]
CELL_INDEX = {cell: index for index, cell in enumerate(CELLS)}
SEMANTIC = [(row, 0) for row in range(9)] + [(9, column) for column in range(8)] + [(10, column) for column in range(8)]
SEMANTIC_INDEX = {cell: index for index, cell in enumerate(SEMANTIC)}
GAZES = [(9, column) for column in range(8)] + [(10, column) for column in range(8)]
GAZE_INDEX = {cell: index for index, cell in enumerate(GAZES)}
ELIGIBLE_TIMED_ROWS = [0, 3, 7]
SURFACES = {
    "dark": np.array([8.0, 11.0, 12.0], dtype=np.float32),
    "light": np.array([243.0, 241.0, 233.0], dtype=np.float32),
}

BASELINE_PATH = ROOT / "qa/arbitrary-phase-baselines.json.gz"
# Updated only after an explicit full authored-profile calibration.  The
# public Node checker independently seals this same byte digest.
EXPECTED_BASELINE_SHA256 = "c4c4552f34a427a09293ebb39a5f1a8a0c9b12d5c276e81baedbe24800b371f1"
PROFILE_LOWER_FACTOR = 0.96
PROFILE_UPPER_FACTOR = 1.04
PROFILE_ZERO_EPSILON = 1e-7
CELL_PROFILE_METRICS = [
    "silhouetteIouExcursion",
    "silhouetteCentroidDiameterPx",
    "alphaAreaRatioExcursion",
    "perceptualDiameterRms",
]
EDGE_PROFILE_METRICS = CELL_PROFILE_METRICS + [
    "samePhaseSilhouetteIouExcursionRms",
    "samePhaseSilhouetteCentroidDistanceRmsPx",
    "samePhaseAlphaAreaRatioExcursionRms",
    "samePhasePerceptualRms",
]

# Frozen after an independent full-cycle calibration.  Each upper/lower limit
# adds only 4% headroom to the observed authored excursion away from identity;
# materiality floors retain 96% of the observed minimum full-cycle diameter.
# Display-path values are filled after the exact browser map is calibrated.
GATES = {
    "source": {
        "withinRows": {
            "0": [0.985844715, 0.685494087, 1.001965773, 19.423896735],
            "1": [0.961010204, 2.507291564, 1.002015947, 14.290606664],
            "2": [0.961106238, 2.49942484, 1.002018057, 14.294982915],
            "3": [0.957378969, 2.473418879, 1.013101354, 15.017137725],
            "4": [0.745531915, 17.961465723, 1.003779042, 41.848738267],
            "5": [0.942550114, 3.643417828, 1.002662904, 22.644768464],
            "6": [0.978083002, 1.21543086, 1.006546872, 24.867107528],
            "7": [0.981561144, 1.218904382, 1.001581983, 25.773522855],
            "8": [0.949078721, 1.600405223, 1.016134498, 32.779510063],
            "9": [0.992089249, 0.289019138, 1.0027945, 3.992507078],
            "10": [0.992279602, 0.284306355, 1.002797687, 3.9286721],
        },
        "families": {
            "timedCellAdvance": [0.745531915, 17.961465723, 1.016134498, 41.848738267, 13.037791915],
            "timedEffectiveReset": [0.822323258, 12.807775368, 1.033751994, 41.445106151, 17.90453766],
            "timedToGaze": [0.794113892, 15.056671466, 1.02656883, 38.482387204, 19.969264957],
            "gazeToTimed": [0.794113892, 15.056671466, 1.02656883, 38.482387204, 19.969264957],
            "adjacentGaze": [0.932523364, 4.382021969, 1.010322754, 24.567582267, 7.492826351],
            "nonNeighborGaze": [0.802229366, 13.961741606, 1.014787707, 35.910801087, 12.870129815],
        },
        "minimumCellFullCyclePerceptualDiameterRms": 3.178426855,
    },
    "codexDefaultDpr2": {
        "withinRows": {
            "0": [0.985639072, 0.855803722, 1.001801137, 19.514547317],
            "1": [0.960177193, 2.99796415, 1.002315977, 14.31260824],
            "2": [0.960387932, 2.982515773, 1.002296177, 14.343070436],
            "3": [0.957715821, 2.933628508, 1.013656472, 14.993654962],
            "4": [0.74515146, 21.079990557, 1.004509068, 41.864182349],
            "5": [0.942828222, 4.315515097, 1.003277182, 22.658609949],
            "6": [0.978766944, 1.359735239, 1.006147151, 24.874974171],
            "7": [0.982166989, 1.379547737, 1.001526874, 25.768559596],
            "8": [0.948414465, 1.942740657, 1.015982883, 32.860282476],
            "9": [0.991531115, 0.371156326, 1.003014138, 4.07383745],
            "10": [0.9917369, 0.36297782, 1.003032533, 4.075557483],
        },
        "families": {
            "timedCellAdvance": [0.74515146, 21.079994434, 1.016084333, 41.872551369, 13.10594018],
            "timedEffectiveReset": [0.822950984, 15.011796337, 1.034030574, 41.463109261, 17.986984919],
            "timedToGaze": [0.794841391, 17.587192535, 1.026074161, 38.458990167, 20.033734223],
            "gazeToTimed": [0.794841391, 17.583436584, 1.026074018, 38.458990167, 20.048807124],
            "adjacentGaze": [0.932430435, 5.11651301, 1.011061491, 24.564424854, 7.475555475],
            "nonNeighborGaze": [0.802431611, 16.287155749, 1.014798694, 35.916528831, 12.783343457],
        },
        "minimumCellFullCyclePerceptualDiameterRms": 3.178538901,
    },
}


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def round9(value):
    if isinstance(value, (float, np.floating)):
        return round(float(value), 9)
    if isinstance(value, dict):
        return {key: round9(item) for key, item in value.items()}
    if isinstance(value, list):
        return [round9(item) for item in value]
    return value


def stable_json_bytes(value) -> bytes:
    return (json.dumps(round9(value), separators=(",", ":")) + "\n").encode()


def graph_order():
    return [
        (family, left, right)
        for family, pairs in family_definitions().items()
        for left, right in pairs
    ]


def graph_trace_sha256() -> str:
    trace = hashlib.sha256()
    for family, left, right in graph_order():
        trace.update(f"{family}|r{left[0]}c{left[1]}->r{right[0]}c{right[1]}\n".encode())
    return trace.hexdigest()


def load_profile_baselines():
    baseline_bytes = BASELINE_PATH.read_bytes()
    digest = sha256(baseline_bytes)
    if digest != EXPECTED_BASELINE_SHA256:
        raise RuntimeError(
            f"arbitrary-phase authored-profile baseline digest mismatch: {digest}"
        )
    baseline_json_bytes = gzip.decompress(baseline_bytes)
    baseline = json.loads(baseline_json_bytes)
    if (
        baseline.get("schemaVersion") != 1
        or baseline.get("kind") != "arbitrary-decoder-phase-authored-profiles"
        or baseline.get("cellProfileMetrics") != CELL_PROFILE_METRICS
        or baseline.get("edgeProfileMetrics") != EDGE_PROFILE_METRICS
        or baseline.get("cellOrder") != [f"r{row}c{column}" for row, column in CELLS]
        or baseline.get("hostGraphOrderedSha256") != graph_trace_sha256()
    ):
        raise RuntimeError("arbitrary-phase authored-profile baseline contract changed")
    for path_id in ("source", "codexDefaultDpr2"):
        for theme in ("dark", "light"):
            branch = baseline.get("paths", {}).get(path_id, {}).get(theme, {})
            if len(branch.get("cells", {}).get("profiles", [])) != len(CELLS):
                raise RuntimeError(f"{path_id}/{theme} cell-profile baseline count changed")
            if len(branch.get("cells", {}).get("orderedMetricTraceSha256", [])) != len(CELLS):
                raise RuntimeError(f"{path_id}/{theme} cell-trace baseline count changed")
            for family, pairs in family_definitions().items():
                family_branch = branch.get("edges", {}).get(family, {})
                if len(family_branch.get("profiles", [])) != len(pairs):
                    raise RuntimeError(f"{path_id}/{theme}/{family} edge-profile baseline count changed")
                if len(family_branch.get("orderedMetricTraceSha256", [])) != len(pairs):
                    raise RuntimeError(f"{path_id}/{theme}/{family} edge-trace baseline count changed")
                if len(family_branch.get("samePhaseMetricTraceSha256", [])) != len(pairs):
                    raise RuntimeError(f"{path_id}/{theme}/{family} same-phase baseline count changed")
                if len(family_branch.get("samePhasePerceptualRms", [])) != len(pairs):
                    raise RuntimeError(f"{path_id}/{theme}/{family} semantic-distance baseline count changed")
    return baseline, digest, sha256(baseline_json_bytes)


def decode_oracle_compact_map(compact):
    if compact[:8] != b"CDP2MAP1":
        raise RuntimeError("browser-oracle map magic mismatch")
    width, height, columns, rows, cell_count = struct.unpack_from("<HHHHH", compact, 8)
    if (width, height, columns, rows, cell_count) != (225, 244, 8, 11, 88):
        raise RuntimeError("browser-oracle compact-map geometry mismatch")
    offset = 18
    maps = {}
    expanded = bytearray()
    for cell in range(cell_count):
        base_x = np.frombuffer(compact[offset:offset + width], dtype=np.uint8).copy()
        offset += width
        base_y = np.frombuffer(compact[offset:offset + height], dtype=np.uint8).copy()
        offset += height
        override_count = struct.unpack_from("<I", compact, offset)[0]
        offset += 4
        local_x = np.broadcast_to(base_x[None, :], (height, width)).astype(np.uint16, copy=True)
        local_y = np.broadcast_to(base_y[:, None], (height, width)).astype(np.uint16, copy=True)
        for _ in range(override_count):
            pixel, source_x, source_y = struct.unpack_from("<HBB", compact, offset)
            offset += 4
            target_y, target_x = divmod(pixel, width)
            local_x[target_y, target_x] = source_x
            local_y[target_y, target_x] = source_y
        if np.any(local_x >= CELL_W) or np.any(local_y >= CELL_H):
            raise RuntimeError(
                f"browser-oracle r{cell // columns}c{cell % columns} contains an out-of-cell source coordinate"
            )
        row, column = divmod(cell, columns)
        maps[(row, column)] = (local_x, local_y)
        interleaved = np.empty((height, width, 2), dtype=np.uint8)
        interleaved[..., 0] = local_x
        interleaved[..., 1] = local_y
        expanded.extend(interleaved.tobytes())
    if offset != len(compact):
        raise RuntimeError("browser-oracle map has trailing bytes")
    return maps, width, height, bytes(expanded)


def load_oracle_map():
    report_bytes = (ROOT / "qa/codex-default-dpr2-browser-oracle.json").read_bytes()
    report = json.loads(report_bytes)
    if report.get("ok") is not True or report.get("kind") != "codex-default-dpr2-browser-oracle":
        raise RuntimeError("browser-oracle report is not sealed as passing")
    compressed = (ROOT / report["sourceMaps"]["compressedPath"]).read_bytes()
    if sha256(compressed) != report["sourceMaps"]["compressedSha256"]:
        raise RuntimeError("browser-oracle compressed-map digest mismatch")
    compact = zlib.decompress(compressed)
    if sha256(compact) != report["sourceMaps"]["compactSha256"]:
        raise RuntimeError("browser-oracle compact-map digest mismatch")
    maps, width, height, expanded_bytes = decode_oracle_compact_map(compact)
    if (
        sha256(expanded_bytes) != report["sourceMaps"]["rawSha256"]
        or report["sourceMaps"]["rawSha256"] != report["sourceMaps"]["roundTripRawSha256"]
    ):
        raise RuntimeError("browser-oracle lossless round-trip digest mismatch")
    corrupt = bytearray(compact)
    corrupt[18] = CELL_W
    try:
        decode_oracle_compact_map(bytes(corrupt))
    except RuntimeError as error:
        if "out-of-cell source coordinate" not in str(error):
            raise RuntimeError("browser-oracle corrupt-coordinate red path raised the wrong failure") from error
    else:
        raise RuntimeError("browser-oracle corrupt-coordinate red path was accepted")
    return report, sha256(report_bytes), maps, width, height


def load_cells(theme: str, path_id: str, maps, display_width: int, display_height: int):
    atlas_path = ROOT / f"pet/grok-bot-{theme}/spritesheet.webp"
    image = Image.open(atlas_path)
    if image.n_frames != PHASES:
        raise RuntimeError(f"{atlas_path} has {image.n_frames} decoder phases")
    if path_id == "source":
        frames = np.empty((len(CELLS), PHASES, CELL_H, CELL_W, 4), dtype=np.uint8)
    else:
        frames = np.empty((len(CELLS), PHASES, display_height, display_width, 4), dtype=np.uint8)
    page_hash = hashlib.sha256()
    alpha_hash = hashlib.sha256()
    for phase in range(PHASES):
        image.seek(phase)
        page = np.asarray(image.convert("RGBA"))
        if page.shape != (ATLAS_H, ATLAS_W, 4):
            raise RuntimeError(f"phase {phase} decoded to {page.shape}")
        page_hash.update(page.tobytes())
        alpha_hash.update(page[..., 3].tobytes())
        for cell_index, (row, column) in enumerate(CELLS):
            if path_id == "source":
                frames[cell_index, phase] = page[
                    row * CELL_H:(row + 1) * CELL_H,
                    column * CELL_W:(column + 1) * CELL_W,
                ]
            else:
                local_x, local_y = maps[(row, column)]
                frames[cell_index, phase] = page[
                    row * CELL_H + local_y,
                    column * CELL_W + local_x,
                ]
    return frames, {
        "path": str(atlas_path.relative_to(ROOT)),
        "fileSha256": sha256(atlas_path.read_bytes()),
        "decodedFullPageStackSha256": page_hash.hexdigest(),
        "decodedAlphaStackSha256": alpha_hash.hexdigest(),
        "phaseCount": image.n_frames,
    }


def topology_feature_vectors(frames: np.ndarray):
    count = len(frames)
    pixels = int(np.prod(frames.shape[1:3]))
    flat = frames.reshape(count, pixels, 4)
    alpha_u8 = flat[..., 3]
    mask = (alpha_u8 >= 128).astype(np.float32)
    silhouette_count = mask.sum(axis=1, dtype=np.float64)
    yy, xx = np.indices(frames.shape[1:3])
    x_flat = xx.reshape(-1).astype(np.float32)
    y_flat = yy.reshape(-1).astype(np.float32)
    centroid_x = (mask @ x_flat) / silhouette_count
    centroid_y = (mask @ y_flat) / silhouette_count
    alpha_area = alpha_u8.sum(axis=1, dtype=np.float64)
    return {
        "mask": mask,
        "silhouetteCount": silhouette_count,
        "centroidX": centroid_x,
        "centroidY": centroid_y,
        "alphaArea": alpha_area,
        "pixels": pixels,
    }


def perceptual_transform_vector(frames: np.ndarray, theme: str, channel: int):
    count = len(frames)
    pixels = int(np.prod(frames.shape[1:3]))
    flat = frames.reshape(count, pixels, 4)
    alpha = flat[..., 3].astype(np.float32) / 255.0
    rgb = flat[..., :3].astype(np.float32)
    surface = SURFACES[theme]
    composite = rgb * alpha[..., None] + surface[None, None, :] * (1.0 - alpha[..., None])
    del rgb, alpha
    red, green, blue = composite[..., 0], composite[..., 1], composite[..., 2]
    if channel == 0:
        transform = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    elif channel == 1:
        transform = (-0.1146 * red - 0.3854 * green + 0.5 * blue) * 0.5
    elif channel == 2:
        transform = (0.5 * red - 0.4542 * green - 0.0458 * blue) * 0.5
    else:
        raise ValueError(f"unsupported perceptual transform channel: {channel}")
    transform64 = transform.astype(np.float64)
    return transform64, np.einsum("ij,ij->i", transform64, transform64)


def feature_vectors(frames: np.ndarray, theme: str):
    vectors = topology_feature_vectors(frames)
    vectors["transforms"] = [
        perceptual_transform_vector(frames, theme, channel)
        for channel in range(3)
    ]
    return vectors


def cross_feature_matrices(left, right):
    intersection = left["mask"] @ right["mask"].T
    union = left["silhouetteCount"][:, None] + right["silhouetteCount"][None, :] - intersection
    iou = intersection / union
    centroid = np.hypot(
        left["centroidX"][:, None] - right["centroidX"][None, :],
        left["centroidY"][:, None] - right["centroidY"][None, :],
    )
    ratio = np.maximum(left["alphaArea"][:, None], right["alphaArea"][None, :]) / np.minimum(
        left["alphaArea"][:, None], right["alphaArea"][None, :]
    )
    perceptual_square = np.zeros((PHASES, PHASES), dtype=np.float64)
    for (left_transform, left_norms), (right_transform, right_norms) in zip(
        left["transforms"], right["transforms"]
    ):
        perceptual_square += left_norms[:, None] + right_norms[None, :] - 2.0 * (left_transform @ right_transform.T)
    np.maximum(perceptual_square, 0, out=perceptual_square)
    perceptual = np.sqrt(perceptual_square / left["pixels"]) / 255.0 * 100.0
    return {"iou": iou, "centroid": centroid, "ratio": ratio, "perceptual": perceptual}


def cross_feature_cache(sequence_frames, matrix_keys, theme):
    """Build every requested cross-sequence matrix while retaining one full-pixel channel at a time."""
    topology = {
        sequence_sha: topology_feature_vectors(frames)
        for sequence_sha, frames in sequence_frames.items()
    }
    matrices = {}
    for matrix_key in matrix_keys:
        left = topology[matrix_key[0]]
        right = topology[matrix_key[1]]
        intersection = left["mask"] @ right["mask"].T
        union = left["silhouetteCount"][:, None] + right["silhouetteCount"][None, :] - intersection
        matrices[matrix_key] = {
            "iou": intersection / union,
            "centroid": np.hypot(
                left["centroidX"][:, None] - right["centroidX"][None, :],
                left["centroidY"][:, None] - right["centroidY"][None, :],
            ),
            "ratio": np.maximum(left["alphaArea"][:, None], right["alphaArea"][None, :]) / np.minimum(
                left["alphaArea"][:, None], right["alphaArea"][None, :]
            ),
            "perceptualSquare": np.zeros((PHASES, PHASES), dtype=np.float64),
            "pixels": left["pixels"],
        }

    # Masks dominate the topology footprint. Once their pair matrices exist,
    # release them before constructing any full-pixel perceptual transforms.
    for vectors in topology.values():
        del vectors["mask"]

    for channel in range(3):
        transforms = {
            sequence_sha: perceptual_transform_vector(frames, theme, channel)
            for sequence_sha, frames in sequence_frames.items()
        }
        for matrix_key in matrix_keys:
            left_transform, left_norms = transforms[matrix_key[0]]
            right_transform, right_norms = transforms[matrix_key[1]]
            matrices[matrix_key]["perceptualSquare"] += (
                left_norms[:, None]
                + right_norms[None, :]
                - 2.0 * (left_transform @ right_transform.T)
            )
        del left_transform, left_norms, right_transform, right_norms, transforms

    for features in matrices.values():
        perceptual_square = features.pop("perceptualSquare")
        pixels = features.pop("pixels")
        np.maximum(perceptual_square, 0, out=perceptual_square)
        features["perceptual"] = np.sqrt(perceptual_square / pixels) / 255.0 * 100.0
    return matrices


def feature_matrices(frames: np.ndarray, theme: str):
    vectors = feature_vectors(frames, theme)
    return cross_feature_matrices(vectors, vectors)


def full_cycle_profile(features):
    """Return authored excursions, with identity-centered metrics normalized to zero."""
    return [
        1.0 - float(features["iou"].min()),
        float(features["centroid"].max()),
        float(features["ratio"].max()) - 1.0,
        float(features["perceptual"].max()),
    ]


def edge_profile(features):
    cross_phase = full_cycle_profile(features)
    diagonal_iou = 1.0 - np.diag(features["iou"])
    diagonal_centroid = np.diag(features["centroid"])
    diagonal_ratio = np.diag(features["ratio"]) - 1.0
    diagonal_perceptual = np.diag(features["perceptual"])
    return cross_phase + [
        float(np.sqrt(np.mean(np.square(diagonal_iou)))),
        float(np.sqrt(np.mean(np.square(diagonal_centroid)))),
        float(np.sqrt(np.mean(np.square(diagonal_ratio)))),
        float(np.sqrt(np.mean(np.square(diagonal_perceptual)))),
    ]


def same_phase_metrics(features):
    return [
        [
            1.0 - float(features["iou"][phase, phase]),
            float(features["centroid"][phase, phase]),
            float(features["ratio"][phase, phase]) - 1.0,
            float(features["perceptual"][phase, phase]),
        ]
        for phase in range(PHASES)
    ]


def metric_rows_trace(rows):
    trace = hashlib.sha256()
    for phase, row in enumerate(rows):
        trace.update(
            (f"p{phase}|" + "|".join(f"{float(value):.9f}" for value in row) + "\n").encode()
        )
    return trace.hexdigest()


def edge_policy(path_id, family, left_cell, right_cell):
    continuity = family == "timedCellAdvance" or (
        family == "timedEffectiveReset" and left_cell[0] == right_cell[0]
    )
    if continuity:
        return "continuityAlias" if path_id == "source" else "sampledContinuity"
    return "semanticDistinction"


def compare_profile(actual, expected, metric_names):
    """Bind each local authored profile to its own narrow two-sided envelope."""
    failures = []
    for metric, actual_value, expected_value in zip(metric_names, actual, expected):
        actual_value = float(actual_value)
        expected_value = float(expected_value)
        if expected_value <= PROFILE_ZERO_EPSILON:
            # A zero authored channel has no materiality floor.  Its upper
            # topology/perceptual behavior remains guarded by the global
            # row/family gates; do not manufacture a noisy local threshold.
            continue
        lower = expected_value * PROFILE_LOWER_FACTOR
        upper = expected_value * PROFILE_UPPER_FACTOR
        if actual_value < lower:
            failures.append({
                "metric": metric,
                "direction": "below",
                "actual": actual_value,
                "required": lower,
                "baseline": expected_value,
            })
        elif actual_value > upper:
            failures.append({
                "metric": metric,
                "direction": "above",
                "actual": actual_value,
                "required": upper,
                "baseline": expected_value,
            })
    return failures


def update_profile_trace(trace, identifier, actual):
    trace.update(
        (identifier + "|" + "|".join(f"{float(value):.9f}" for value in actual) + "\n").encode()
    )


class Accumulator:
    def __init__(self, gate=None):
        self.count = 0
        self.failures = 0
        self.minimum_iou = (float("inf"), None)
        self.maximum_centroid = (-float("inf"), None)
        self.maximum_ratio = (-float("inf"), None)
        self.maximum_perceptual = (-float("inf"), None)
        self.minimum_perceptual = (float("inf"), None)
        self.digest = hashlib.sha256()
        self.gate = gate

    def add(self, identifier, iou, centroid, ratio, perceptual):
        iou, centroid, ratio, perceptual = map(float, (iou, centroid, ratio, perceptual))
        self.count += 1
        if iou < self.minimum_iou[0]: self.minimum_iou = (iou, identifier)
        if centroid > self.maximum_centroid[0]: self.maximum_centroid = (centroid, identifier)
        if ratio > self.maximum_ratio[0]: self.maximum_ratio = (ratio, identifier)
        if perceptual > self.maximum_perceptual[0]: self.maximum_perceptual = (perceptual, identifier)
        if perceptual < self.minimum_perceptual[0]: self.minimum_perceptual = (perceptual, identifier)
        self.digest.update(
            f"{identifier}|{iou:.9f}|{centroid:.9f}|{ratio:.9f}|{perceptual:.9f}\n".encode()
        )
        if self.gate is not None:
            minimum_iou, maximum_centroid, maximum_ratio, maximum_perceptual = self.gate[:4]
            if not (
                iou >= minimum_iou
                and centroid <= maximum_centroid
                and ratio <= maximum_ratio
                and perceptual <= maximum_perceptual
            ):
                self.failures += 1

    def merge(self, other):
        self.count += other.count
        self.failures += other.failures
        for name, compare in (
            ("minimum_iou", lambda a, b: a < b),
            ("maximum_centroid", lambda a, b: a > b),
            ("maximum_ratio", lambda a, b: a > b),
            ("maximum_perceptual", lambda a, b: a > b),
            ("minimum_perceptual", lambda a, b: a < b),
        ):
            candidate = getattr(other, name)
            if compare(candidate[0], getattr(self, name)[0]): setattr(self, name, candidate)
        self.digest.update(other.digest.digest())

    def report(self):
        return {
            "count": self.count,
            "failingPairCount": self.failures,
            "orderedMetricTraceSha256": self.digest.hexdigest(),
            "minimumSilhouetteIou": {"value": self.minimum_iou[0], "id": self.minimum_iou[1]},
            "maximumSilhouetteCentroidDistancePx": {"value": self.maximum_centroid[0], "id": self.maximum_centroid[1]},
            "maximumAlphaAreaRatioSymmetric": {"value": self.maximum_ratio[0], "id": self.maximum_ratio[1]},
            "maximumPerceptualRms": {"value": self.maximum_perceptual[0], "id": self.maximum_perceptual[1]},
            "minimumPerceptualRmsObserved": {"value": self.minimum_perceptual[0], "id": self.minimum_perceptual[1]},
        }


def consume_block(accumulator, features, prefix, left_offset=0, right_offset=0, include_identity=True):
    for phase_from in range(PHASES):
        for phase_to in range(PHASES):
            if not include_identity and phase_from == phase_to:
                continue
            left = left_offset + phase_from
            right = right_offset + phase_to
            accumulator.add(
                f"{prefix}:p{phase_from}->p{phase_to}",
                features["iou"][left, right],
                features["centroid"][left, right],
                features["ratio"][left, right],
                features["perceptual"][left, right],
            )


def within_report(frames, theme, path_gates, profile_baselines=None, profile_collector=None):
    rows = {str(row): Accumulator(None if path_gates is None else path_gates["withinRows"][str(row)]) for row in range(11)}
    material_diameters = []
    material_failures = []
    profile_failures = []
    profile_trace = hashlib.sha256()
    for cell_index, (row, column) in enumerate(CELLS):
        features = feature_matrices(frames[cell_index], theme)
        cell_accumulator = Accumulator(None if path_gates is None else path_gates["withinRows"][str(row)])
        consume_block(cell_accumulator, features, f"r{row}c{column}", include_identity=False)
        rows[str(row)].merge(cell_accumulator)
        diameter = float(features["perceptual"].max())
        material_diameters.append((diameter, f"r{row}c{column}"))
        if path_gates is not None and diameter < path_gates["minimumCellFullCyclePerceptualDiameterRms"]:
            material_failures.append(f"r{row}c{column}")
        profile = full_cycle_profile(features)
        identifier = f"r{row}c{column}"
        update_profile_trace(profile_trace, identifier, profile)
        if profile_collector is not None:
            profile_collector["profiles"].append(round9(profile))
            profile_collector["orderedMetricTraceSha256"].append(cell_accumulator.digest.hexdigest())
        if profile_baselines is not None:
            failures = compare_profile(
                profile,
                profile_baselines["profiles"][cell_index],
                CELL_PROFILE_METRICS,
            )
            expected_trace = profile_baselines["orderedMetricTraceSha256"][cell_index]
            actual_trace = cell_accumulator.digest.hexdigest()
            if actual_trace != expected_trace:
                failures.append({
                    "metric": "orderedFullCycleMetricTraceSha256",
                    "direction": "changed",
                    "actual": actual_trace,
                    "required": expected_trace,
                    "baseline": expected_trace,
                })
            if failures:
                profile_failures.append({"id": identifier, "failures": round9(failures)})
    global_accumulator = Accumulator()
    for accumulator in rows.values(): global_accumulator.merge(accumulator)
    minimum_diameter = min(material_diameters)
    maximum_diameter = max(material_diameters)
    return {
        "allReachableCells": global_accumulator.report(),
        "byRow": {row: accumulator.report() for row, accumulator in rows.items()},
        "fullCycleMateriality": {
            "minimumCellPerceptualDiameterRms": {"value": minimum_diameter[0], "id": minimum_diameter[1]},
            "maximumCellPerceptualDiameterRms": {"value": maximum_diameter[0], "id": maximum_diameter[1]},
            "minimumRequiredPerceptualDiameterRms": None if path_gates is None else path_gates["minimumCellFullCyclePerceptualDiameterRms"],
            "failingCellCount": len(material_failures),
            "failingCellIds": material_failures,
            "authoredPerCellBaseline": {
                "comparedCellCount": 0 if profile_baselines is None else len(CELLS),
                "failingCellCount": len(profile_failures),
                "failingCells": profile_failures,
                "orderedProfileTraceSha256": profile_trace.hexdigest(),
                "retainedExcursionFactor": PROFILE_LOWER_FACTOR,
                "maximumExcursionFactor": PROFILE_UPPER_FACTOR,
            },
        },
    }


def family_definitions(path_id="source"):
    del path_id  # The source and exact-browser paths enumerate the same host graph.
    timed_cells = [(row, column) for row in range(9) for column in range(ROW_COUNTS[row])]
    timed_advances = [
        ((row, column), (row, (column + 1) % ROW_COUNTS[row]))
        for row in range(9)
        for column in range(ROW_COUNTS[row])
    ]
    timed_resets = [
        (left, (right_row, 0))
        for left in timed_cells
        for right_row in range(9)
        if left[0] != right_row
    ] + [
        ((0, column), (0, 0))
        for column in range(1, ROW_COUNTS[0] - 1)
    ]
    return {
        # Disjoint families: idle c5->c0 is counted as a cyclic advance, not a
        # second time as an effective-state reset.
        "timedCellAdvance": timed_advances,
        "timedEffectiveReset": timed_resets,
        "timedToGaze": [(left, right) for left in timed_cells for right in GAZES],
        "gazeToTimed": [(left, (right, 0)) for left in GAZES for right in range(9)],
        "adjacentGaze": [(left, right) for left in GAZES for right in GAZES if (GAZE_INDEX[left] - GAZE_INDEX[right]) % 16 in (1, 15)],
        "nonNeighborGaze": [(left, right) for left in GAZES for right in GAZES if (GAZE_INDEX[left] - GAZE_INDEX[right]) % 16 not in (0, 1, 15)],
    }


def semantic_report(
    frames,
    theme,
    path_id,
    path_gates,
    profile_baselines=None,
    profile_collector=None,
):
    definitions = family_definitions(path_id)
    cells = sorted(set(cell for pairs in definitions.values() for pair in pairs for cell in pair))
    sequence_frames = {}
    sequence_hashes = {}
    for cell in cells:
        cell_frames = frames[CELL_INDEX[cell]]
        sequence_sha = sha256(cell_frames.tobytes())
        sequence_hashes[cell] = sequence_sha
        sequence_frames.setdefault(sequence_sha, cell_frames)
    matrix_keys = sorted({
        (sequence_hashes[left_cell], sequence_hashes[right_cell])
        for cell_pairs in definitions.values()
        for left_cell, right_cell in cell_pairs
    })
    matrix_cache = cross_feature_cache(sequence_frames, matrix_keys, theme)
    reports = {}
    for family, cell_pairs in definitions.items():
        gate = None if path_gates is None else path_gates["families"][family]
        accumulator = Accumulator(gate)
        material_diameters = []
        family_profile_failures = []
        family_profile_trace = hashlib.sha256()
        policy_counts = {"continuityAlias": 0, "sampledContinuity": 0, "semanticDistinction": 0}
        family_baselines = None if profile_baselines is None else profile_baselines[family]
        family_collector = None if profile_collector is None else profile_collector[family]
        for edge_index, (left_cell, right_cell) in enumerate(cell_pairs):
            matrix_key = (sequence_hashes[left_cell], sequence_hashes[right_cell])
            features = matrix_cache[matrix_key]
            edge_accumulator = Accumulator(gate)
            consume_block(
                edge_accumulator,
                features,
                f"r{left_cell[0]}c{left_cell[1]}->r{right_cell[0]}c{right_cell[1]}",
            )
            accumulator.merge(edge_accumulator)
            material_diameters.append((
                float(features["perceptual"].max()),
                f"r{left_cell[0]}c{left_cell[1]}->r{right_cell[0]}c{right_cell[1]}",
            ))
            identifier = f"r{left_cell[0]}c{left_cell[1]}->r{right_cell[0]}c{right_cell[1]}"
            profile = edge_profile(features)
            diagonal_rows = same_phase_metrics(features)
            diagonal_trace = metric_rows_trace(diagonal_rows)
            policy = edge_policy(path_id, family, left_cell, right_cell)
            policy_counts[policy] += 1
            update_profile_trace(family_profile_trace, identifier, profile)
            if family_collector is not None:
                family_collector["profiles"].append(round9(profile))
                family_collector["orderedMetricTraceSha256"].append(edge_accumulator.digest.hexdigest())
                family_collector["samePhaseMetricTraceSha256"].append(diagonal_trace)
                family_collector["samePhasePerceptualRms"].append(
                    round9([row[3] for row in diagonal_rows])
                )
            if family_baselines is not None:
                failures = compare_profile(
                    profile,
                    family_baselines["profiles"][edge_index],
                    EDGE_PROFILE_METRICS,
                )
                expected_full_trace = family_baselines["orderedMetricTraceSha256"][edge_index]
                if edge_accumulator.digest.hexdigest() != expected_full_trace:
                    failures.append({
                        "metric": "orderedAllPhaseMetricTraceSha256",
                        "direction": "changed",
                        "actual": edge_accumulator.digest.hexdigest(),
                        "required": expected_full_trace,
                        "baseline": expected_full_trace,
                    })
                expected_diagonal_trace = family_baselines["samePhaseMetricTraceSha256"][edge_index]
                if diagonal_trace != expected_diagonal_trace:
                    failures.append({
                        "metric": "orderedSamePhaseMetricTraceSha256",
                        "direction": "changed",
                        "actual": diagonal_trace,
                        "required": expected_diagonal_trace,
                        "baseline": expected_diagonal_trace,
                    })
                if policy == "continuityAlias":
                    if not np.array_equal(
                        frames[CELL_INDEX[left_cell]],
                        frames[CELL_INDEX[right_cell]],
                    ):
                        failures.append({
                            "metric": "samePhaseByteIdentity",
                            "direction": "changed",
                            "actual": False,
                            "required": True,
                            "baseline": True,
                        })
                elif policy == "semanticDistinction":
                    expected_distances = family_baselines["samePhasePerceptualRms"][edge_index]
                    collapsed_phases = [
                        phase
                        for phase, (actual_row, expected_distance) in enumerate(
                            zip(diagonal_rows, expected_distances)
                        )
                        if expected_distance > PROFILE_ZERO_EPSILON
                        and actual_row[3] < expected_distance * PROFILE_LOWER_FACTOR
                    ]
                    if collapsed_phases:
                        failures.append({
                            "metric": "samePhaseSemanticPerceptualDistance",
                            "direction": "below",
                            "actual": collapsed_phases,
                            "required": "each authored nonzero phase retains 96%",
                            "baseline": "per-phase authored distance",
                        })
                if failures:
                    family_profile_failures.append({
                        "id": identifier,
                        "policy": policy,
                        "failures": round9(failures),
                    })
        minimum_materiality = min(material_diameters)
        minimum_required = None if gate is None else gate[4]
        report = accumulator.report()
        report["statePairCount"] = len(cell_pairs)
        report["fullCycleMateriality"] = {
            "minimumStatePairMaximumPerceptualRms": {"value": minimum_materiality[0], "id": minimum_materiality[1]},
            "minimumRequiredPerceptualRms": minimum_required,
            "failingStatePairCount": 0 if minimum_required is None else sum(value < minimum_required for value, _ in material_diameters),
        }
        report["authoredPerEdgeBaseline"] = {
            "comparedEdgeCount": 0 if family_baselines is None else len(cell_pairs),
            "failingEdgeCount": len(family_profile_failures),
            "failingEdges": family_profile_failures,
            "orderedProfileTraceSha256": family_profile_trace.hexdigest(),
            "retainedExcursionFactor": PROFILE_LOWER_FACTOR,
            "maximumExcursionFactor": PROFILE_UPPER_FACTOR,
            "samePhaseSemanticMetric": "samePhasePerceptualRms",
            "policyCounts": policy_counts,
            "policy": {
                "continuityAlias": "source same-phase decoded bytes must remain identical",
                "sampledContinuity": "exact browser-sampled same-phase seam metrics and every all-phase metric trace are sealed per edge",
                "semanticDistinction": "every authored nonzero same-phase perceptual distance and aggregate same-phase energy retain at least 96%",
            },
        }
        reports[family] = report
    return reports


def recommended_gates(theme_reports, path_id):
    # Cross-theme gates take the worst authored excursion.  Headroom applies to
    # the excursion from identity, never to the raw identity-centered metric.
    recommended = {"withinRows": {}, "families": {}}
    for row in map(str, range(11)):
        reports = [theme_reports[theme]["within"]["byRow"][row] for theme in ("dark", "light")]
        min_iou = min(report["minimumSilhouetteIou"]["value"] for report in reports)
        max_centroid = max(report["maximumSilhouetteCentroidDistancePx"]["value"] for report in reports)
        max_ratio = max(report["maximumAlphaAreaRatioSymmetric"]["value"] for report in reports)
        max_rms = max(report["maximumPerceptualRms"]["value"] for report in reports)
        recommended["withinRows"][row] = [1 - 1.04 * (1 - min_iou), max_centroid * 1.04, 1 + 1.04 * (max_ratio - 1), max_rms * 1.04]
    minimum_cell_diameter = min(
        theme_reports[theme]["within"]["fullCycleMateriality"]["minimumCellPerceptualDiameterRms"]["value"]
        for theme in ("dark", "light")
    )
    recommended["minimumCellFullCyclePerceptualDiameterRms"] = minimum_cell_diameter * 0.96
    for family in family_definitions(path_id):
        reports = [theme_reports[theme]["stateSwitchFamilies"][family] for theme in ("dark", "light")]
        min_iou = min(report["minimumSilhouetteIou"]["value"] for report in reports)
        max_centroid = max(report["maximumSilhouetteCentroidDistancePx"]["value"] for report in reports)
        max_ratio = max(report["maximumAlphaAreaRatioSymmetric"]["value"] for report in reports)
        max_rms = max(report["maximumPerceptualRms"]["value"] for report in reports)
        min_materiality = min(report["fullCycleMateriality"]["minimumStatePairMaximumPerceptualRms"]["value"] for report in reports)
        recommended["families"][family] = [1 - 1.04 * (1 - min_iou), max_centroid * 1.04, 1 + 1.04 * (max_ratio - 1), max_rms * 1.04, min_materiality * 0.96]
    return round9(recommended)


def timed_column_equivalence(frames, path_id):
    rows = {}
    all_equal = True
    trace = hashlib.sha256()
    for row in range(9):
        hashes = [sha256(frames[CELL_INDEX[(row, column)]].tobytes()) for column in range(ROW_COUNTS[row])]
        unique = len(set(hashes))
        equal = unique == 1
        all_equal = all_equal and equal
        for column, digest in enumerate(hashes):
            trace.update(f"r{row}c{column}|{digest}\n".encode())
        rows[str(row)] = {
            "columnCount": len(hashes),
            "uniqueRenderedSequenceCount": unique,
            "allColumnsEqualToC0": equal,
            "orderedSequenceSha256": hashes,
        }
    return {
        "path": path_id,
        "allTimedColumnsEqualToC0": all_equal,
        "orderedTraceSha256": trace.hexdigest(),
        "rows": rows,
    }


def empty_profile_branch():
    return {
        "cells": {"profiles": [], "orderedMetricTraceSha256": []},
        "edges": {
            family: {
                "profiles": [],
                "orderedMetricTraceSha256": [],
                "samePhaseMetricTraceSha256": [],
                "samePhasePerceptualRms": [],
            }
            for family in family_definitions()
        },
    }


def new_baseline_artifact(oracle):
    return {
        "schemaVersion": 1,
        "kind": "arbitrary-decoder-phase-authored-profiles",
        "contract": {
            "profileDomain": "all 60x60 ordered decoder-phase metrics per reachable cell and changed-cell edge",
            "exactTraceSeal": "any rounded per-cell or per-edge metric-trace change is a zero-tolerance failure and requires explicit reviewed baseline regeneration",
            "localEnvelope": "the 96%-104% per-profile envelopes diagnose whether a changed local excursion collapsed or expanded; they do not weaken the exact trace seal",
            "semanticDistance": "same-phase authored perceptual distance is retained per phase; cross-phase maxima are not semantic evidence",
            "continuityPolicies": {
                "continuityAlias": "source continuity aliases require same-phase byte identity",
                "sampledContinuity": "browser-sampled continuity aliases bind all 60 same-phase seam metrics by trace",
                "semanticDistinction": "every authored nonzero same-phase perceptual distance and aggregate energy retains at least 96%",
            },
        },
        "cellProfileMetrics": CELL_PROFILE_METRICS,
        "edgeProfileMetrics": EDGE_PROFILE_METRICS,
        "cellOrder": [f"r{row}c{column}" for row, column in CELLS],
        "hostGraphOrderedSha256": graph_trace_sha256(),
        "inputs": {
            "browserMapRawSha256": oracle["sourceMaps"]["rawSha256"],
            "atlases": {},
        },
        "paths": {
            path_id: {theme: empty_profile_branch() for theme in ("dark", "light")}
            for path_id in ("source", "codexDefaultDpr2")
        },
    }


def run(calibrate=False, build_baselines=False, replace_baselines=False):
    oracle, oracle_report_sha, maps, display_width, display_height = load_oracle_map()
    baseline_artifact = new_baseline_artifact(oracle) if build_baselines else None
    if replace_baselines:
        profile_baselines, baseline_sha, baseline_json_sha = None, None, None
    else:
        profile_baselines, baseline_sha, baseline_json_sha = load_profile_baselines()
    definitions_by_path = {path_id: family_definitions(path_id) for path_id in ("source", "codexDefaultDpr2")}
    unique_edges_by_path = {
        path_id: set(pair for pairs in definitions.values() for pair in pairs)
        for path_id, definitions in definitions_by_path.items()
    }
    if any(len(edges) != 1813 for edges in unique_edges_by_path.values()):
        raise RuntimeError("host graph no longer contains exactly 1,813 unique changed-cell edges")
    pair_counts_by_path = {
        path_id: {
            "within": len(CELLS) * PHASES * (PHASES - 1),
            "stateSwitch": sum(len(pairs) for pairs in definitions.values()) * PHASES * PHASES,
        }
        for path_id, definitions in definitions_by_path.items()
    }
    for counts in pair_counts_by_path.values(): counts["total"] = counts["within"] + counts["stateSwitch"]
    result = {
        "schemaVersion": 1,
        "kind": "arbitrary-decoder-phase-browser-host-qa",
        "contract": {
            "phaseDomain": "every ordered p->q decoder-phase pair; p!=q within one cell and all p,q across state-switch cells",
            "longSkipPolicy": "full-cycle topology and intended-surface perceptual bounds only; no adjacent-step, local-energy, acceleration, or frame-drop ratio is applied to a long skip",
            "withinReachableCellCount": len(CELLS),
            "orderedPairCountsPerTheme": pair_counts_by_path,
            "renderedPixelCountsPerTheme": {
                "source": len(CELLS) * PHASES * CELL_W * CELL_H,
                "codexDefaultDpr2": len(CELLS) * PHASES * display_width * display_height,
            },
            "hostGraph": {
                "renderedFramesPerThemePerPath": len(CELLS) * PHASES,
                "uniqueChangedCellEdgesPerPath": 1813,
                "rawTimedEffectiveResetMembership": 461,
                "timedAdvanceMembership": 57,
                "overlapAssignedOnlyToTimedAdvance": "r0c5->r0c0",
                "disjointTimedEffectiveResetTraceCount": 460,
                "timedToGazeEdges": 912,
                "gazeToTimedEdges": 144,
                "gazeToDifferentGazeEdges": 240,
            },
            "paths": {
                "source": {"width": CELL_W, "height": CELL_H},
                "codexDefaultDpr2": {"width": display_width, "height": display_height, "cssWidthExpression": oracle["target"]["cssWidthExpression"], "devicePixelRatio": 2},
            },
        },
        "thresholdPolicy": {
            "upperBounds": "4% headroom on the measured authored excursion from identity",
            "materialityLowerBounds": "96% of the measured minimum full-cycle perceptual diameter",
            "calibrationMode": calibrate,
            "authoredProfileBaseline": {
                "path": str(BASELINE_PATH.relative_to(ROOT)),
                "sha256": baseline_sha,
                "uncompressedJsonSha256": baseline_json_sha,
                "retainedExcursionFactor": PROFILE_LOWER_FACTOR,
                "maximumExcursionFactor": PROFILE_UPPER_FACTOR,
                "generationMode": build_baselines,
                "reviewedReplacementMode": replace_baselines,
                "exactTracePolicy": "zero tolerance; any rounded ordered metric-trace change requires explicit reviewed regeneration",
                "envelopeRole": "diagnoses the direction and magnitude of a local change; it is not an exception to the exact trace seal",
            },
        },
        "browserOracle": {
            "reportSha256": oracle_report_sha,
            "compressedMapSha256": oracle["sourceMaps"]["compressedSha256"],
            "rawRoundTripSha256": oracle["sourceMaps"]["roundTripRawSha256"],
            "renderer": oracle["renderer"],
            "pythonLoaderOutOfRangeRedPath": "rejected source x=192 before any atlas indexing",
        },
        "paths": {},
        "errors": [],
    }
    alpha_by_path_theme = {}
    for path_id in ("source", "codexDefaultDpr2"):
        print(f"arbitrary-phase: {path_id}", file=sys.stderr, flush=True)
        theme_reports = {}
        path_gates = None if calibrate else GATES[path_id]
        for theme in ("dark", "light"):
            print(f"  decode/analyze {theme}", file=sys.stderr, flush=True)
            frames, atlas = load_cells(theme, path_id, maps, display_width, display_height)
            alpha_digest = sha256(frames[..., 3].tobytes())
            alpha_by_path_theme[(path_id, theme)] = alpha_digest
            branch_baselines = None if profile_baselines is None else profile_baselines["paths"][path_id][theme]
            branch_collector = None if baseline_artifact is None else baseline_artifact["paths"][path_id][theme]
            within = within_report(
                frames,
                theme,
                path_gates,
                None if branch_baselines is None else branch_baselines["cells"],
                None if branch_collector is None else branch_collector["cells"],
            )
            semantic = semantic_report(
                frames,
                theme,
                path_id,
                path_gates,
                None if branch_baselines is None else branch_baselines["edges"],
                None if branch_collector is None else branch_collector["edges"],
            )
            equivalence = timed_column_equivalence(frames, path_id)
            theme_reports[theme] = {
                "atlas": atlas,
                "reachableAlphaSha256": alpha_digest,
                "within": within,
                "stateSwitchFamilies": semantic,
                "timedColumnEquivalence": equivalence,
            }
            if baseline_artifact is not None:
                baseline_artifact["inputs"]["atlases"][theme] = {
                    "path": atlas["path"],
                    "fileSha256": atlas["fileSha256"],
                    "decodedFullPageStackSha256": atlas["decodedFullPageStackSha256"],
                }
            del frames
        result["paths"][path_id] = {
            "gates": path_gates,
            "themes": theme_reports,
            "crossThemeAlphaParity": alpha_by_path_theme[(path_id, "dark")] == alpha_by_path_theme[(path_id, "light")],
        }
        if calibrate:
            result["paths"][path_id]["recommendedGates"] = recommended_gates(theme_reports, path_id)
    for path_id, path_report in result["paths"].items():
        if not path_report["crossThemeAlphaParity"]:
            result["errors"].append(f"{path_id} dark/light alpha paths differ")
        if calibrate:
            continue
        for theme, theme_report in path_report["themes"].items():
            if path_id == "source" and not theme_report["timedColumnEquivalence"]["allTimedColumnsEqualToC0"]:
                result["errors"].append(f"{path_id}/{theme} timed c0 state-switch alias is invalid")
            within = theme_report["within"]
            if within["allReachableCells"]["failingPairCount"]:
                result["errors"].append(f"{path_id}/{theme} within-cell arbitrary phases failed")
            if within["fullCycleMateriality"]["failingCellCount"]:
                result["errors"].append(f"{path_id}/{theme} full-cycle cell materiality failed")
            if within["fullCycleMateriality"]["authoredPerCellBaseline"]["failingCellCount"]:
                result["errors"].append(f"{path_id}/{theme} authored per-cell profile changed")
            for family, family_report in theme_report["stateSwitchFamilies"].items():
                if family_report["failingPairCount"]:
                    result["errors"].append(f"{path_id}/{theme}/{family} arbitrary phases failed")
                if family_report["fullCycleMateriality"]["failingStatePairCount"]:
                    result["errors"].append(f"{path_id}/{theme}/{family} full-cycle materiality failed")
                if family_report["authoredPerEdgeBaseline"]["failingEdgeCount"]:
                    result["errors"].append(f"{path_id}/{theme}/{family} authored per-edge profile changed")
    result["ok"] = len(result["errors"]) == 0
    return round9(result), round9(baseline_artifact) if baseline_artifact is not None else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--calibrate", action="store_true")
    parser.add_argument("--write-baselines", action="store_true")
    parser.add_argument("--replace-baselines-reviewed", action="store_true")
    parser.add_argument("--output", default="qa/arbitrary-phase-qa.json")
    arguments = parser.parse_args()
    baseline_modes = int(arguments.write_baselines) + int(arguments.replace_baselines_reviewed)
    if baseline_modes > 1:
        parser.error("--write-baselines and --replace-baselines-reviewed are mutually exclusive")
    if arguments.calibrate and baseline_modes:
        parser.error("--calibrate cannot be combined with a baseline-writing mode")
    report, baseline_artifact = run(
        arguments.calibrate,
        bool(baseline_modes),
        arguments.replace_baselines_reviewed,
    )
    if baseline_artifact is not None:
        if not report["ok"]:
            for error in report["errors"]:
                print(f"error: {error}", file=sys.stderr)
            raise SystemExit("refusing to overwrite authored-profile baselines because the non-calibration QA run failed")
        baseline_json_bytes = stable_json_bytes(baseline_artifact)
        baseline_bytes = gzip.compress(baseline_json_bytes, compresslevel=9, mtime=0)
        if arguments.write_baselines and sha256(baseline_bytes) != EXPECTED_BASELINE_SHA256:
            raise SystemExit(
                "refusing to replace the authored-profile seal: ordinary --write-baselines is a reproducibility check; "
                "use --replace-baselines-reviewed only after an explicit visual review"
            )
        if arguments.write_baselines:
            print(
                f"VERIFIED: {BASELINE_PATH.relative_to(ROOT)} reproducibly matches "
                f"sha256={EXPECTED_BASELINE_SHA256}; no file was rewritten"
            )
            return
        temporary_path = BASELINE_PATH.with_name(f".{BASELINE_PATH.name}.tmp")
        temporary_path.write_bytes(baseline_bytes)
        os.replace(temporary_path, BASELINE_PATH)
        print(
            f"WROTE: {BASELINE_PATH.relative_to(ROOT)} sha256={sha256(baseline_bytes)} "
            f"jsonSha256={sha256(baseline_json_bytes)}; "
            "seal this digest in both generators before the release check"
        )
        return
    output = ROOT / arguments.output
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"{'PASS' if report['ok'] else 'FAIL'}: arbitrary decoder phases; "
        f"{sum(item['total'] for item in report['contract']['orderedPairCountsPerTheme'].values())} ordered pairs/theme across paths, "
        f"{len(report['errors'])} errors"
    )
    if report["errors"]:
        for error in report["errors"]: print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
