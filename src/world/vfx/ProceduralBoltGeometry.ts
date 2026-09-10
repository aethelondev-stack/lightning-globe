import * as THREE from 'three';
import type { BoltSegment } from '../../types/vfx';
import { EngineConfig } from '../../core/Config';

/**
 * Midpoint Displacement procedural 3D electrical lightning arc generator.
 *
 * Generates realistic jagged discharge channels from cloud altitude to ground
 * with unified main trunk polyline and probabilistic branching forks.
 * Includes exact arc-length parameterization for threaded electric charge beads.
 */

export interface BoltGeneratorOptions {
  depth?: number;
  displacementScale?: number;
  branchProbability?: number;
  isPositive?: boolean;
}

export interface BoltGeometryResult {
  segments: BoltSegment[];
  mainTrunk: THREE.Vector3[];
  arcLengths: number[];
  totalLength: number;
}

/**
 * Unified generation of bolt segments and the exact main trunk polyline.
 * Guarantees that electric charges sliding on the spine lie 100% on the rendered line segments.
 */
export function generateBoltGeometry(
  start: THREE.Vector3,
  end: THREE.Vector3,
  options?: BoltGeneratorOptions
): BoltGeometryResult {
  const distance = start.distanceTo(end);
  if (distance < 0.001 || isNaN(distance)) {
    return { segments: [], mainTrunk: [], arcLengths: [], totalLength: 0 };
  }

  const depth = options?.depth ?? 5;
  const baseScale = options?.displacementScale ?? EngineConfig.vfx.boltDisplacementScale;
  const branchProb = options?.branchProbability ?? EngineConfig.vfx.boltBranchProbability;
  const isPositive = options?.isPositive ?? false;

  const MAX_SEGMENTS = 144;

  // 1. Initial Curvilinear Meander: Create an organic curved spine (natural C/S-curve arc)
  // Instead of a rigid straight line, real lightning follows natural ion channel bends
  const initialPoints: THREE.Vector3[] = [start.clone()];
  const mainDir = new THREE.Vector3().subVectors(end, start);
  const mainLen = mainDir.length();

  const refVec0 = Math.abs(mainDir.y / mainLen) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const lateralNorm = new THREE.Vector3().crossVectors(mainDir, refVec0).normalize();
  const lateralBi = new THREE.Vector3().crossVectors(mainDir, lateralNorm).normalize();

  // Pick a dominant sweeping curve direction with 2 intermediate inflection waypoints
  const sweepAngle = Math.random() * Math.PI * 2;
  const sweepVector = new THREE.Vector3()
    .addScaledVector(lateralNorm, Math.cos(sweepAngle))
    .addScaledVector(lateralBi, Math.sin(sweepAngle))
    .normalize();

  const curveBend1 = (0.08 + Math.random() * 0.12) * mainLen;
  const curveBend2 = (0.05 + Math.random() * 0.10) * mainLen * (Math.random() < 0.4 ? -1 : 0.7);

  // Waypoint 1 at ~33% descent
  const w1 = new THREE.Vector3()
    .copy(start)
    .addScaledVector(mainDir, 0.33)
    .addScaledVector(sweepVector, curveBend1);
  // Waypoint 2 at ~66% descent
  const w2 = new THREE.Vector3()
    .copy(start)
    .addScaledVector(mainDir, 0.66)
    .addScaledVector(sweepVector, curveBend2);

  initialPoints.push(w1, w2, end.clone());

  let mainTrunk: THREE.Vector3[] = initialPoints;
  const branchSegments: BoltSegment[] = [];

  let persistentAngle = sweepAngle;

  for (let level = 0; level < depth; level++) {
    const nextTrunk: THREE.Vector3[] = [];
    const scale = baseScale * Math.pow(0.52, level);

    for (let i = 0; i < mainTrunk.length - 1; i++) {
      const p0 = mainTrunk[i];
      const p1 = mainTrunk[i + 1];
      const segDir = new THREE.Vector3().subVectors(p1, p0);
      const segLen = segDir.length();

      nextTrunk.push(p0);

      if (segLen < 0.01) {
        continue;
      }

      // Midpoint
      const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);

      // Construct perpendicular displacement plane
      const refVec = Math.abs(segDir.y / segLen) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const normal = new THREE.Vector3().crossVectors(segDir, refVec).normalize();
      const binormal = new THREE.Vector3().crossVectors(segDir, normal).normalize();

      // Persistent Angular Meandering: smoothly curves rather than jagged sawteeth
      const angleDelta = (Math.random() - 0.5) * 1.4;
      persistentAngle += angleDelta;
      const displacement = (0.35 + Math.random() * 0.65) * scale;

      mid.addScaledVector(normal, Math.cos(persistentAngle) * displacement);
      mid.addScaledVector(binormal, Math.sin(persistentAngle) * displacement);

      // Strict Globe Clearance Enforcement: Never allow lightning trunk to sag into Earth sphere
      const midDist = mid.length();
      const minSurfaceR = EngineConfig.globe.radius + 0.35;
      if (midDist < minSurfaceR && midDist > 0.001) {
        mid.multiplyScalar(minSurfaceR / midDist);
      }

      nextTrunk.push(mid);

      // Probabilistic branching for forks (natural curving forks)
      if (!isPositive && level >= 1 && level <= 3 && Math.random() < branchProb && (mainTrunk.length + branchSegments.length) < MAX_SEGMENTS - 2) {
        const branchAngle = persistentAngle + (Math.random() > 0.5 ? 0.7 : -0.7);
        const forkDir = segDir
          .clone()
          .multiplyScalar(0.42)
          .addScaledVector(normal, Math.cos(branchAngle) * scale * 1.2)
          .addScaledVector(binormal, Math.sin(branchAngle) * scale * 1.2);

        const forkEnd = mid.clone().add(forkDir);
        const forkDist = forkEnd.length();
        if (forkDist < minSurfaceR && forkDist > 0.001) {
          forkEnd.multiplyScalar(minSurfaceR / forkDist);
        }
        branchSegments.push({ start: mid.clone(), end: forkEnd });

        // Secondary fork kink
        if (Math.random() < 0.5 && (mainTrunk.length + branchSegments.length) < MAX_SEGMENTS - 2) {
          const subForkDir = forkDir
            .clone()
            .multiplyScalar(0.55)
            .addScaledVector(normal, (Math.random() - 0.5) * scale * 0.7)
            .addScaledVector(binormal, (Math.random() - 0.5) * scale * 0.7);
          const subForkEnd = forkEnd.clone().add(subForkDir);
          const subDist = subForkEnd.length();
          if (subDist < minSurfaceR && subDist > 0.001) {
            subForkEnd.multiplyScalar(minSurfaceR / subDist);
          }
          branchSegments.push({ start: forkEnd.clone(), end: subForkEnd });
        }
      }
    }

    nextTrunk.push(mainTrunk[mainTrunk.length - 1]);
    mainTrunk = nextTrunk;
  }

  // Assemble line segments from main trunk edges
  const segments: BoltSegment[] = [];
  for (let i = 0; i < mainTrunk.length - 1; i++) {
    if (segments.length >= MAX_SEGMENTS) break;
    segments.push({ start: mainTrunk[i].clone(), end: mainTrunk[i + 1].clone() });
  }

  // Append branch segments up to ceiling
  for (let i = 0; i < branchSegments.length; i++) {
    if (segments.length >= MAX_SEGMENTS) break;
    segments.push(branchSegments[i]);
  }

  // Pre-calculate cumulative arc lengths along the main trunk polyline
  const arcLengths: number[] = [0];
  let accumLength = 0;
  for (let i = 1; i < mainTrunk.length; i++) {
    accumLength += mainTrunk[i].distanceTo(mainTrunk[i - 1]);
    arcLengths.push(accumLength);
  }

  return {
    segments,
    mainTrunk,
    arcLengths,
    totalLength: accumLength
  };
}

/**
 * Backward compatibility wrapper for generateBoltSegments.
 */
export function generateBoltSegments(
  start: THREE.Vector3,
  end: THREE.Vector3,
  options?: BoltGeneratorOptions
): BoltSegment[] {
  return generateBoltGeometry(start, end, options).segments;
}

/**
 * Backward compatibility wrapper for generateBoltSpine.
 */
export function generateBoltSpine(
  start: THREE.Vector3,
  end: THREE.Vector3,
  depth: number = 4,
  displacementScale: number = 2.0
): THREE.Vector3[] {
  return generateBoltGeometry(start, end, { depth, displacementScale }).mainTrunk;
}

/**
 * Interpolates along the spine points array at fraction u in [0, 1] without heap allocation.
 * Uses exact arc-length parameterization when arcLengths and totalLength are provided.
 */
export function sampleSpinePoint(
  points: THREE.Vector3[],
  u: number,
  target: THREE.Vector3,
  arcLengths?: number[],
  totalLength?: number
): void {
  if (points.length === 0) return;
  const clampedU = Math.max(0, Math.min(1.0, u));
  if (points.length === 1 || clampedU <= 0) {
    target.copy(points[0]);
    return;
  }
  if (clampedU >= 1.0) {
    target.copy(points[points.length - 1]);
    return;
  }

  // Arc-length parameterization for smooth constant-speed progression
  if (arcLengths && totalLength && totalLength > 0.0001 && arcLengths.length === points.length) {
    const targetDist = clampedU * totalLength;

    // Linear/binary scan to find enclosing segment
    let low = 0;
    let high = arcLengths.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (arcLengths[mid] <= targetDist) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idx0 = Math.max(0, Math.min(points.length - 2, high));
    const idx1 = idx0 + 1;
    const segStartDist = arcLengths[idx0];
    const segEndDist = arcLengths[idx1];
    const segSpan = segEndDist - segStartDist;

    const frac = segSpan > 0.00001 ? (targetDist - segStartDist) / segSpan : 0;
    target.lerpVectors(points[idx0], points[idx1], Math.max(0, Math.min(1, frac)));
    return;
  }

  // Fallback index-based lerp
  const floatIdx = clampedU * (points.length - 1);
  const idx = Math.floor(floatIdx);
  const frac = floatIdx - idx;
  const p0 = points[idx];
  const p1 = points[Math.min(idx + 1, points.length - 1)];

  target.lerpVectors(p0, p1, frac);
}

export interface ThickBoltOptions {
  strands?: number;
  radius?: number;
  mainTrunkCount?: number;
}

/**
 * Packs procedural bolt segments into a high-density multi-strand radial plasma filament bundle.
 * Solves the WebGL 1px linewidth limitation on desktop/mobile GPUs by generating a cylindrical envelope
 * of parallel additive strands surrounding the central core axis.
 *
 * Guaranteed properties:
 * 1. Strand 0 is ALWAYS the exact central axis (mainTrunk), ensuring energy beads stay 100% on the channel.
 * 2. Peripheral strands are radially distributed around the central axis, giving uniform thickness from any camera angle.
 * 3. Additive blending naturally yields a hyper-bright white core with a soft glowing plasma corona.
 * 4. Strands and radius scale proportionally with lightning strike intensity.
 */
export function writeThickBoltSegmentsToBuffer(
  segments: BoltSegment[],
  targetPositions: Float32Array,
  options?: ThickBoltOptions
): number {
  let offset = 0;
  const strands = Math.max(1, options?.strands ?? 1);
  const baseRadius = Math.max(0, options?.radius ?? 0);
  const mainCount = options?.mainTrunkCount ?? segments.length;

  const tempDir = new THREE.Vector3();
  const tempNorm = new THREE.Vector3();
  const tempBinorm = new THREE.Vector3();
  const tempOffset = new THREE.Vector3();

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i].start;
    const e = segments[i].end;

    // 1. Write the central core strand (Strand 0) - exact path
    if (offset + 6 > targetPositions.length) break;
    targetPositions[offset++] = s.x;
    targetPositions[offset++] = s.y;
    targetPositions[offset++] = s.z;
    targetPositions[offset++] = e.x;
    targetPositions[offset++] = e.y;
    targetPositions[offset++] = e.z;

    // If single strand or zero radius, continue
    if (strands <= 1 || baseRadius <= 0.001) {
      continue;
    }

    // Determine strand count and radius for this segment (branches are slightly thinner than main trunk)
    const isMain = i < mainCount;
    const segStrands = isMain ? strands : Math.min(strands, 3);
    const segRadius = isMain ? baseRadius : baseRadius * 0.55;

    tempDir.subVectors(e, s);
    const len = tempDir.length();
    if (len < 0.001) continue;
    tempDir.multiplyScalar(1.0 / len);

    // Form orthonormal perpendicular frame
    if (Math.abs(tempDir.y) > 0.92) {
      tempNorm.crossVectors(tempDir, new THREE.Vector3(1, 0, 0)).normalize();
    } else {
      tempNorm.crossVectors(tempDir, new THREE.Vector3(0, 1, 0)).normalize();
    }
    tempBinorm.crossVectors(tempDir, tempNorm).normalize();

    // 2. Write peripheral radial strands
    const peripheralCount = segStrands - 1;
    for (let k = 0; k < peripheralCount; k++) {
      if (offset + 6 > targetPositions.length) break;

      const angle = (k * Math.PI * 2) / peripheralCount;
      const cosA = Math.cos(angle) * segRadius;
      const sinA = Math.sin(angle) * segRadius;

      tempOffset.copy(tempNorm).multiplyScalar(cosA).addScaledVector(tempBinorm, sinA);

      // Start + offset
      targetPositions[offset++] = s.x + tempOffset.x;
      targetPositions[offset++] = s.y + tempOffset.y;
      targetPositions[offset++] = s.z + tempOffset.z;

      // End + offset
      targetPositions[offset++] = e.x + tempOffset.x;
      targetPositions[offset++] = e.y + tempOffset.y;
      targetPositions[offset++] = e.z + tempOffset.z;
    }
  }

  // Clear remaining unused slots with 0
  for (let i = offset; i < targetPositions.length; i++) {
    targetPositions[i] = 0;
  }

  return offset / 3;
}

/**
 * Packs bolt line segments directly into a pre-allocated Float32Array buffer.
 * Supports optional multi-strand thickness options while maintaining 100% backward compatibility.
 * Eliminates garbage collection allocation.
 */
export function writeSegmentsToBuffer(
  segments: BoltSegment[],
  targetPositions: Float32Array,
  options?: ThickBoltOptions
): number {
  if (options && options.strands && options.strands > 1) {
    return writeThickBoltSegmentsToBuffer(segments, targetPositions, options);
  }

  let offset = 0;

  for (let i = 0; i < segments.length; i++) {
    if (offset + 6 > targetPositions.length) break;

    const s = segments[i].start;
    const e = segments[i].end;

    // Start vertex
    targetPositions[offset++] = s.x;
    targetPositions[offset++] = s.y;
    targetPositions[offset++] = s.z;

    // End vertex
    targetPositions[offset++] = e.x;
    targetPositions[offset++] = e.y;
    targetPositions[offset++] = e.z;
  }

  // Clear remaining unused slots with 0
  for (let i = offset; i < targetPositions.length; i++) {
    targetPositions[i] = 0;
  }

  return offset / 3;
}

export interface BoltRibbonOptions {
  baseWidth: number;
  mainTrunkCount?: number;
  mainTrunk?: THREE.Vector3[];
  progresses?: Float32Array;
}

/**
 * Builds a camera-facing continuous triangle strip ribbon mesh for a single-body volumetric lightning discharge.
 * Solves the disconnected segment issue by computing smooth shared miter tangents at every vertex joint.
 * Guaranteed continuous surface with zero tearing, zero cracks, and zero disjointed rectangular quads.
 */
export function writeBoltRibbonGeometry(
  segments: BoltSegment[],
  positions: Float32Array,
  dirs: Float32Array,
  sides: Float32Array,
  widths: Float32Array,
  indices: Uint16Array,
  options: BoltRibbonOptions
): { vertexCount: number; indexCount: number } {
  let vOffset = 0; // Float index for positions & dirs (x, y, z)
  let sOffset = 0; // Float index for sides & widths (scalar)
  let iOffset = 0; // Index offset for triangles

  const baseWidth = options.baseWidth;
  const mainCount = options.mainTrunkCount ?? segments.length;
  const trunk = options.mainTrunk;

  const tempTan = new THREE.Vector3();
  const dirIn = new THREE.Vector3();
  const dirOut = new THREE.Vector3();

  // 1. If mainTrunk polyline is provided, write it as an unbroken, continuous shared-node ribbon
  if (trunk && trunk.length >= 2) {
    const N = trunk.length;
    const trunkStartVertex = sOffset;

    for (let k = 0; k < N; k++) {
      if (vOffset + 6 > positions.length || sOffset + 2 > widths.length) break;

      const pt = trunk[k];

      // Compute shared miter tangent at node k
      if (k === 0) {
        tempTan.subVectors(trunk[1], trunk[0]).normalize();
      } else if (k === N - 1) {
        tempTan.subVectors(trunk[N - 1], trunk[N - 2]).normalize();
      } else {
        dirIn.subVectors(trunk[k], trunk[k - 1]).normalize();
        dirOut.subVectors(trunk[k + 1], trunk[k]).normalize();
        tempTan.addVectors(dirIn, dirOut);
        if (tempTan.lengthSq() < 0.0001) {
          tempTan.copy(dirOut);
        } else {
          tempTan.normalize();
        }
      }

      const prog = N > 1 ? k / (N - 1) : 0.0;
      if (options.progresses && sOffset + 1 < options.progresses.length) {
        options.progresses[sOffset] = prog;
        options.progresses[sOffset + 1] = prog;
      }

      // Left vertex (side: -1.0)
      positions[vOffset] = pt.x;
      positions[vOffset + 1] = pt.y;
      positions[vOffset + 2] = pt.z;
      dirs[vOffset] = tempTan.x;
      dirs[vOffset + 1] = tempTan.y;
      dirs[vOffset + 2] = tempTan.z;
      sides[sOffset] = -1.0;
      widths[sOffset] = baseWidth;

      // Right vertex (side: +1.0)
      positions[vOffset + 3] = pt.x;
      positions[vOffset + 4] = pt.y;
      positions[vOffset + 5] = pt.z;
      dirs[vOffset + 3] = tempTan.x;
      dirs[vOffset + 4] = tempTan.y;
      dirs[vOffset + 5] = tempTan.z;
      sides[sOffset + 1] = 1.0;
      widths[sOffset + 1] = baseWidth;

      vOffset += 6;
      sOffset += 2;
    }

    // Connect nodes into continuous triangles: exactly 2 triangles per segment
    const validNodes = Math.min(N, (sOffset - trunkStartVertex) / 2);
    for (let k = 0; k < validNodes - 1; k++) {
      if (iOffset + 6 > indices.length) break;
      const v0 = trunkStartVertex + k * 2;
      const v1 = trunkStartVertex + k * 2 + 1;
      const v2 = trunkStartVertex + (k + 1) * 2;
      const v3 = trunkStartVertex + (k + 1) * 2 + 1;

      // Tri 1
      indices[iOffset++] = v0;
      indices[iOffset++] = v1;
      indices[iOffset++] = v2;

      // Tri 2
      indices[iOffset++] = v2;
      indices[iOffset++] = v1;
      indices[iOffset++] = v3;
    }

    // 2. Append secondary branch forks (starting after mainCount)
    for (let i = mainCount; i < segments.length; i++) {
      const s = segments[i].start;
      const e = segments[i].end;

      tempTan.subVectors(e, s);
      const len = tempTan.length();
      if (len < 0.0001) continue;
      tempTan.multiplyScalar(1.0 / len);

      const branchWidth = baseWidth * 0.52;
      if (vOffset + 12 > positions.length || iOffset + 6 > indices.length) break;

      const startProg = trunk && trunk.length > 1 ? Math.min(1.0, s.distanceTo(trunk[0]) / Math.max(0.01, trunk[trunk.length - 1].distanceTo(trunk[0]))) : 0.5;
      if (options.progresses && sOffset + 3 < options.progresses.length) {
        options.progresses[sOffset] = startProg;
        options.progresses[sOffset + 1] = startProg;
        options.progresses[sOffset + 2] = Math.min(1.0, startProg + 0.12);
        options.progresses[sOffset + 3] = Math.min(1.0, startProg + 0.12);
      }

      const baseVertex = sOffset;

      // Start Left
      positions[vOffset] = s.x; positions[vOffset + 1] = s.y; positions[vOffset + 2] = s.z;
      dirs[vOffset] = tempTan.x; dirs[vOffset + 1] = tempTan.y; dirs[vOffset + 2] = tempTan.z;
      sides[sOffset] = -1.0; widths[sOffset] = branchWidth;

      // Start Right
      positions[vOffset + 3] = s.x; positions[vOffset + 4] = s.y; positions[vOffset + 5] = s.z;
      dirs[vOffset + 3] = tempTan.x; dirs[vOffset + 4] = tempTan.y; dirs[vOffset + 5] = tempTan.z;
      sides[sOffset + 1] = 1.0; widths[sOffset + 1] = branchWidth;

      // End Left
      positions[vOffset + 6] = e.x; positions[vOffset + 7] = e.y; positions[vOffset + 8] = e.z;
      dirs[vOffset + 6] = tempTan.x; dirs[vOffset + 7] = tempTan.y; dirs[vOffset + 8] = tempTan.z;
      sides[sOffset + 2] = -1.0; widths[sOffset + 2] = branchWidth;

      // End Right
      positions[vOffset + 9] = e.x; positions[vOffset + 10] = e.y; positions[vOffset + 11] = e.z;
      dirs[vOffset + 9] = tempTan.x; dirs[vOffset + 10] = tempTan.y; dirs[vOffset + 11] = tempTan.z;
      sides[sOffset + 3] = 1.0; widths[sOffset + 3] = branchWidth;

      indices[iOffset++] = baseVertex;
      indices[iOffset++] = baseVertex + 1;
      indices[iOffset++] = baseVertex + 2;

      indices[iOffset++] = baseVertex + 2;
      indices[iOffset++] = baseVertex + 1;
      indices[iOffset++] = baseVertex + 3;

      vOffset += 12;
      sOffset += 4;
    }
  } else {
    // Fallback if mainTrunk array is omitted: render segments with direction normalization
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i].start;
      const e = segments[i].end;

      tempTan.subVectors(e, s);
      const len = tempTan.length();
      if (len < 0.0001) continue;
      tempTan.multiplyScalar(1.0 / len);

      const isMain = i < mainCount;
      const segWidth = isMain ? baseWidth : baseWidth * 0.52;
      if (vOffset + 12 > positions.length || iOffset + 6 > indices.length) break;

      const baseVertex = sOffset;

      const segProg = Math.min(1.0, i / Math.max(1, segments.length));
      if (options.progresses && sOffset + 3 < options.progresses.length) {
        options.progresses[sOffset] = segProg;
        options.progresses[sOffset + 1] = segProg;
        options.progresses[sOffset + 2] = Math.min(1.0, segProg + 0.08);
        options.progresses[sOffset + 3] = Math.min(1.0, segProg + 0.08);
      }

      positions[vOffset] = s.x; positions[vOffset + 1] = s.y; positions[vOffset + 2] = s.z;
      dirs[vOffset] = tempTan.x; dirs[vOffset + 1] = tempTan.y; dirs[vOffset + 2] = tempTan.z;
      sides[sOffset] = -1.0; widths[sOffset] = segWidth;

      positions[vOffset + 3] = s.x; positions[vOffset + 4] = s.y; positions[vOffset + 5] = s.z;
      dirs[vOffset + 3] = tempTan.x; dirs[vOffset + 4] = tempTan.y; dirs[vOffset + 5] = tempTan.z;
      sides[sOffset + 1] = 1.0; widths[sOffset + 1] = segWidth;

      positions[vOffset + 6] = e.x; positions[vOffset + 7] = e.y; positions[vOffset + 8] = e.z;
      dirs[vOffset + 6] = tempTan.x; dirs[vOffset + 7] = tempTan.y; dirs[vOffset + 8] = tempTan.z;
      sides[sOffset + 2] = -1.0; widths[sOffset + 2] = segWidth;

      positions[vOffset + 9] = e.x; positions[vOffset + 10] = e.y; positions[vOffset + 11] = e.z;
      dirs[vOffset + 9] = tempTan.x; dirs[vOffset + 10] = tempTan.y; dirs[vOffset + 11] = tempTan.z;
      sides[sOffset + 3] = 1.0; widths[sOffset + 3] = segWidth;

      indices[iOffset++] = baseVertex;
      indices[iOffset++] = baseVertex + 1;
      indices[iOffset++] = baseVertex + 2;

      indices[iOffset++] = baseVertex + 2;
      indices[iOffset++] = baseVertex + 1;
      indices[iOffset++] = baseVertex + 3;

      vOffset += 12;
      sOffset += 4;
    }
  }

  // Clear remaining unused slots
  for (let i = vOffset; i < positions.length; i++) positions[i] = 0;
  for (let i = vOffset; i < dirs.length; i++) dirs[i] = 0;
  for (let i = sOffset; i < sides.length; i++) sides[i] = 0;
  for (let i = sOffset; i < widths.length; i++) widths[i] = 0;
  for (let i = iOffset; i < indices.length; i++) indices[i] = 0;

  return { vertexCount: sOffset, indexCount: iOffset };
}
