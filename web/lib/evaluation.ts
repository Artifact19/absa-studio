import { SentimentLabel } from "@/lib/types";

export interface ConfusionMatrix {
  // [human_index][model_index]
  // 0: negative, 1: neutral, 2: positive
  labels: SentimentLabel[];
  matrix: number[][];
  total: number;
}

export interface ClassMetrics {
  precision: number;
  recall: number;
  f1: number;
  support: number;
  tp: number;
  fp: number;
  fn: number;
}

export interface EvaluationResults {
  total: number;
  accuracy: number;
  macroF1: number;
  weightedF1: number;
  
  // Kappa Suite
  kappaUnweighted: number;
  kappaLinear: number;
  kappaQuadratic: number;
  observedAgreement: number;
  expectedAgreement: number;
  interpretation: {
    unweighted: string;
    linear: string;
    quadratic: string;
  };

  // Error Analysis
  offByOneCount: number;
  offByOneRate: number;
  polarFlipCount: number;
  polarFlipRate: number;

  // Calibration
  meanConfidence: number;
  confidenceOnAgreements: number;
  confidenceOnDisagreements: number;
  overconfidentDisagreementCount: number;
  overconfidentDisagreementRate: number;

  // Per-Class Metrics
  perClass: Record<SentimentLabel, ClassMetrics>;
  confusionMatrix: ConfusionMatrix;
}

export interface EvaluatedRow {
  id: string;
  topic_key: string;
  aspect?: string | null;
  human_label: SentimentLabel;
  model_label: SentimentLabel;
  label_source?: string | null;
  confidence: number;
  p_pos?: number;
  p_neg?: number;
  p_neu?: number;
}

export function getLandisKochInterpretation(kappa: number): string {
  if (kappa < 0) return "Poor / Worse than chance";
  if (kappa <= 0.20) return "Slight Agreement";
  if (kappa <= 0.40) return "Fair Agreement";
  if (kappa <= 0.60) return "Moderate Agreement";
  if (kappa <= 0.80) return "Substantial Agreement";
  return "Almost Perfect Agreement";
}

export function computeEvaluation(rows: EvaluatedRow[]): EvaluationResults | null {
  const labelOrder: SentimentLabel[] = ["negative", "neutral", "positive"];
  const k = labelOrder.length; // 3
  const matrix: number[][] = Array.from({ length: k }, () => Array(k).fill(0));

  let total = 0;
  let totalConfidence = 0;
  let agreeConfidenceSum = 0;
  let agreeCount = 0;
  let disagreeConfidenceSum = 0;
  let disagreeCount = 0;
  let overconfidentDisagreements = 0;

  for (const r of rows) {
    const hIdx = labelOrder.indexOf(r.human_label);
    const mIdx = labelOrder.indexOf(r.model_label);
    if (hIdx === -1 || mIdx === -1) continue;

    matrix[hIdx][mIdx]++;
    total++;

    const conf = r.confidence ?? Math.max(r.p_pos || 0, r.p_neg || 0, r.p_neu || 0);
    totalConfidence += conf;

    if (hIdx === mIdx) {
      agreeCount++;
      agreeConfidenceSum += conf;
    } else {
      disagreeCount++;
      disagreeConfidenceSum += conf;
      if (conf >= 0.8) {
        overconfidentDisagreements++;
      }
    }
  }

  if (total === 0) return null;

  // Marginal sums
  const rowMarginals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const colMarginals = Array(k).fill(0);
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < k; i++) {
      colMarginals[j] += matrix[i][j];
    }
  }

  // 1. Unweighted Cohen's Kappa
  let observedAgreement = 0;
  let chanceAgreement = 0;
  for (let i = 0; i < k; i++) {
    observedAgreement += matrix[i][i];
    chanceAgreement += rowMarginals[i] * colMarginals[i];
  }
  const po = observedAgreement / total;
  const pe = chanceAgreement / (total * total);
  const kappaUnweighted = pe === 1 ? 1 : (po - pe) / (1 - pe);

  // 2. Linearly Weighted Cohen's Kappa: w_ij = 1 - |i - j| / (k - 1)
  let poLinear = 0;
  let peLinear = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const wLinear = 1 - Math.abs(i - j) / (k - 1);
      poLinear += wLinear * matrix[i][j];
      peLinear += wLinear * (rowMarginals[i] * colMarginals[j]);
    }
  }
  poLinear = poLinear / total;
  peLinear = peLinear / (total * total);
  const kappaLinear = peLinear === 1 ? 1 : (poLinear - peLinear) / (1 - peLinear);

  // 3. Quadratically Weighted Cohen's Kappa: w_ij = 1 - (i - j)^2 / (k - 1)^2
  let poQuad = 0;
  let peQuad = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const wQuad = 1 - Math.pow(i - j, 2) / Math.pow(k - 1, 2);
      poQuad += wQuad * matrix[i][j];
      peQuad += wQuad * (rowMarginals[i] * colMarginals[j]);
    }
  }
  poQuad = poQuad / total;
  peQuad = peQuad / (total * total);
  const kappaQuadratic = peQuad === 1 ? 1 : (poQuad - peQuad) / (1 - peQuad);

  // 4. Per-Class Precision, Recall, F1
  const perClass = {} as Record<SentimentLabel, ClassMetrics>;
  let macroF1Sum = 0;
  let weightedF1Sum = 0;

  labelOrder.forEach((label, idx) => {
    const tp = matrix[idx][idx];
    const fp = colMarginals[idx] - tp;
    const fn = rowMarginals[idx] - tp;
    const support = rowMarginals[idx];

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    perClass[label] = {
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4)),
      support,
      tp,
      fp,
      fn,
    };

    macroF1Sum += f1;
    weightedF1Sum += f1 * support;
  });

  const macroF1 = Number((macroF1Sum / k).toFixed(4));
  const weightedF1 = Number((weightedF1Sum / total).toFixed(4));
  const accuracy = Number((agreeCount / total).toFixed(4));

  // 5. Error Breakdown: Off-by-one vs Polar Flip
  // Matrix indices: 0: negative, 1: neutral, 2: positive
  // Polar flips: (0, 2) or (2, 0)
  const polarFlipCount = matrix[0][2] + matrix[2][0];
  const polarFlipRate = Number((polarFlipCount / total).toFixed(4));

  // Off-by-one: (0, 1), (1, 0), (1, 2), (2, 1)
  const offByOneCount = matrix[0][1] + matrix[1][0] + matrix[1][2] + matrix[2][1];
  const offByOneRate = Number((offByOneCount / total).toFixed(4));

  return {
    total,
    accuracy,
    macroF1,
    weightedF1,
    kappaUnweighted: Number(kappaUnweighted.toFixed(4)),
    kappaLinear: Number(kappaLinear.toFixed(4)),
    kappaQuadratic: Number(kappaQuadratic.toFixed(4)),
    observedAgreement: Number(po.toFixed(4)),
    expectedAgreement: Number(pe.toFixed(4)),
    interpretation: {
      unweighted: getLandisKochInterpretation(kappaUnweighted),
      linear: getLandisKochInterpretation(kappaLinear),
      quadratic: getLandisKochInterpretation(kappaQuadratic),
    },
    offByOneCount,
    offByOneRate,
    polarFlipCount,
    polarFlipRate,
    meanConfidence: Number((totalConfidence / total).toFixed(4)),
    confidenceOnAgreements: agreeCount > 0 ? Number((agreeConfidenceSum / agreeCount).toFixed(4)) : 0,
    confidenceOnDisagreements: disagreeCount > 0 ? Number((disagreeConfidenceSum / disagreeCount).toFixed(4)) : 0,
    overconfidentDisagreementCount: overconfidentDisagreements,
    overconfidentDisagreementRate: disagreeCount > 0 ? Number((overconfidentDisagreements / disagreeCount).toFixed(4)) : 0,
    perClass,
    confusionMatrix: {
      labels: labelOrder,
      matrix,
      total,
    },
  };
}
