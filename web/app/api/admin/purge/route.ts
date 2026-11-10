import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { isRequestAuthorized, verifyCsrfOrigin, verifyAdminPasskey } from "@/lib/auth";
import { normalizeTopicKey } from "@/lib/clean";

// Purge rate limiting: max 4 purge attempts per 15 minutes per IP
const purgeRateLimitMap = new Map<string, { count: number; firstAttempt: number }>();
const PURGE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_PURGE_ATTEMPTS = 4;

function checkPurgeRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = purgeRateLimitMap.get(ip);

  if (!record || now - record.firstAttempt > PURGE_RATE_LIMIT_WINDOW_MS) {
    purgeRateLimitMap.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: MAX_PURGE_ATTEMPTS - 1 };
  }

  if (record.count >= MAX_PURGE_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }

  record.count += 1;
  return { allowed: true, remaining: MAX_PURGE_ATTEMPTS - record.count };
}

/**
 * GET /api/admin/purge
 * Dry-run preview: calculates exact impact of proposed purge without modifying data.
 */
export async function GET(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") || "topic"; // "topic" | "unlabeled" | "retention" | "all"
    const rawTopic = searchParams.get("topic") || "";
    const topicKey = rawTopic ? normalizeTopicKey(rawTopic) : "";
    const olderThanDays = parseInt(searchParams.get("olderThanDays") || "0", 10);
    const preserveHumanTruth = searchParams.get("preserveHumanTruth") !== "false"; // default true

    const supabase = sb();

    // Base query builder for total matching in scope
    let baseTotalQuery = supabase.from("absa_tweets").select("*", { count: "exact", head: true });
    let baseLabeledQuery = supabase.from("absa_tweets").select("*", { count: "exact", head: true }).not("human_label", "is", null);
    let baseUnlabeledQuery = supabase.from("absa_tweets").select("*", { count: "exact", head: true }).is("human_label", null);

    if (scope === "topic" || scope === "unlabeled") {
      if (!topicKey && scope === "topic") {
        return NextResponse.json({ error: "Topic is required for topic scope" }, { status: 400 });
      }
      if (topicKey) {
        baseTotalQuery = baseTotalQuery.eq("topic_key", topicKey);
        baseLabeledQuery = baseLabeledQuery.eq("topic_key", topicKey);
        baseUnlabeledQuery = baseUnlabeledQuery.eq("topic_key", topicKey);
      }
    } else if (scope === "retention") {
      if (!olderThanDays || isNaN(olderThanDays) || olderThanDays <= 0) {
        return NextResponse.json({ error: "Valid olderThanDays is required for retention scope" }, { status: 400 });
      }
      const cutoffDate = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
      if (topicKey && topicKey !== "all") {
        baseTotalQuery = baseTotalQuery.eq("topic_key", topicKey).lt("time", cutoffDate);
        baseLabeledQuery = baseLabeledQuery.eq("topic_key", topicKey).lt("time", cutoffDate);
        baseUnlabeledQuery = baseUnlabeledQuery.eq("topic_key", topicKey).lt("time", cutoffDate);
      } else {
        baseTotalQuery = baseTotalQuery.lt("time", cutoffDate);
        baseLabeledQuery = baseLabeledQuery.lt("time", cutoffDate);
        baseUnlabeledQuery = baseUnlabeledQuery.lt("time", cutoffDate);
      }
    } else if (scope === "all") {
      // Full database wipe scope
    }

    const [
      { count: totalCount, error: errTotal },
      { count: labeledCount, error: errLabeled },
      { count: unlabeledCount, error: errUnlabeled },
    ] = await Promise.all([baseTotalQuery, baseLabeledQuery, baseUnlabeledQuery]);

    if (errTotal || errLabeled || errUnlabeled) {
      console.error("Preview query error:", errTotal || errLabeled || errUnlabeled);
      return NextResponse.json({ error: "Failed to query database for preview" }, { status: 500 });
    }

    const total = totalCount || 0;
    const labeled = labeledCount || 0;
    const unlabeled = unlabeledCount || 0;

    // Calculate actual targets based on preserveHumanTruth and scope
    let targetRecords = 0;
    let preservedRecords = 0;

    if (scope === "unlabeled") {
      targetRecords = unlabeled;
      preservedRecords = labeled;
    } else if (preserveHumanTruth) {
      targetRecords = unlabeled;
      preservedRecords = labeled;
    } else {
      targetRecords = total;
      preservedRecords = 0;
    }

    return NextResponse.json({
      scope,
      topicKey,
      olderThanDays: olderThanDays || undefined,
      preserveHumanTruth,
      total,
      labeled,
      unlabeled,
      targetRecords,
      preservedRecords,
      requiresSevereWarning: !preserveHumanTruth && labeled > 0,
    });
  } catch (err) {
    console.error("Unhandled error in purge preview:", err);
    return NextResponse.json({ error: "Failed to generate purge preview" }, { status: 500 });
  }
}

/**
 * POST /api/admin/purge
 * Multi-stage strictly authorized purge execution endpoint.
 * Requires:
 * 1. Admin session authorization
 * 2. CSRF verification
 * 3. Rate limiting check
 * 4. Strict constant-time ADMIN_PASSKEY match
 * 5. Exact confirmation phrase match
 */
export async function POST(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!verifyCsrfOrigin(req)) {
    return NextResponse.json({ error: "CSRF verification failed" }, { status: 403 });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-ip";
  const rateLimit = checkPurgeRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many purge attempts. Cooldown in effect (15 minutes)." },
      { status: 429 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      passkey,
      scope = "topic",
      topic = "",
      olderThanDays,
      preserveHumanTruth = true,
      confirmDestroyGroundTruth = false,
      confirmationPhrase = "",
    } = body;

    // Stage 3 Strict Gate: Master Passkey Verification
    if (!passkey || typeof passkey !== "string") {
      return NextResponse.json(
        { error: "Admin master passkey is required for purge execution." },
        { status: 400 }
      );
    }

    const isPasskeyValid = verifyAdminPasskey(passkey.trim());
    if (!isPasskeyValid) {
      console.warn(`[SECURITY ALERT] Failed purge passkey attempt from IP ${clientIp} for scope "${scope}"`);
      return NextResponse.json(
        { error: "Invalid admin master passkey. Purge authorization denied." },
        { status: 403 }
      );
    }

    const topicKey = topic ? normalizeTopicKey(topic) : "";

    // Stage 2 Gate: Confirmation Phrase Verification
    const expectedPhrase =
      scope === "all"
        ? "PERMANENTLY PURGE ALL DATA"
        : scope === "unlabeled"
        ? `PURGE UNLABELED ${topicKey ? topicKey.toUpperCase() : "ALL"}`
        : scope === "retention"
        ? `PURGE OLDER THAN ${olderThanDays} DAYS`
        : `DELETE ${topicKey.toUpperCase()}`;

    if (confirmationPhrase.trim().toUpperCase() !== expectedPhrase.trim().toUpperCase()) {
      return NextResponse.json(
        {
          error: `Confirmation phrase mismatch. Expected: "${expectedPhrase}"`,
        },
        { status: 400 }
      );
    }

    const supabase = sb();
    let deleteQuery = supabase.from("absa_tweets").delete({ count: "exact" });

    // Build targeted delete criteria
    if (scope === "topic") {
      if (!topicKey) {
        return NextResponse.json({ error: "Topic is required" }, { status: 400 });
      }
      deleteQuery = deleteQuery.eq("topic_key", topicKey);
      if (preserveHumanTruth) {
        deleteQuery = deleteQuery.is("human_label", null);
      }
    } else if (scope === "unlabeled") {
      deleteQuery = deleteQuery.is("human_label", null);
      if (topicKey) {
        deleteQuery = deleteQuery.eq("topic_key", topicKey);
      }
    } else if (scope === "retention") {
      const days = parseInt(olderThanDays, 10);
      if (isNaN(days) || days <= 0) {
        return NextResponse.json({ error: "Valid olderThanDays is required" }, { status: 400 });
      }
      const cutoffDate = new Date(Date.now() - days * 86_400_000).toISOString();
      deleteQuery = deleteQuery.lt("time", cutoffDate);
      if (topicKey && topicKey !== "all") {
        deleteQuery = deleteQuery.eq("topic_key", topicKey);
      }
      if (preserveHumanTruth) {
        deleteQuery = deleteQuery.is("human_label", null);
      }
    } else if (scope === "all") {
      // Full database wipe
      if (preserveHumanTruth) {
        deleteQuery = deleteQuery.is("human_label", null);
      } else if (!confirmDestroyGroundTruth) {
        return NextResponse.json(
          { error: "Purging all data including human annotations requires explicit confirmation." },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json({ error: `Unknown scope: ${scope}` }, { status: 400 });
    }

    // Execute deletion
    const { count, error: deleteError } = await deleteQuery;

    if (deleteError) {
      console.error("[SECURITY ERROR] Purge database execution failed:", deleteError);
      return NextResponse.json({ error: "Database execution failed while purging records" }, { status: 500 });
    }

    console.log(
      `[SECURITY AUDIT] Data purge SUCCESS from IP ${clientIp}: deleted ${count} records (scope: ${scope}, topic: ${topicKey || "n/a"}, preserveHumanTruth: ${preserveHumanTruth})`
    );

    return NextResponse.json(
      {
        success: true,
        deleted: count || 0,
        scope,
        topic: topicKey || undefined,
        preserveHumanTruth,
        message: `Successfully purged ${count || 0} record(s).`,
      },
      { headers: { "X-Robots-Tag": "noindex" } }
    );
  } catch (err) {
    console.error("Unhandled error in purge POST:", err);
    return NextResponse.json({ error: "Purge execution failed" }, { status: 500 });
  }
}

