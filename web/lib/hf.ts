/**
 * HF Inference Client with retry & exponential backoff per §11
 */

export async function hf<T>(path: string, body: unknown, tries = 3): Promise<T> {
  const baseUrl = process.env.HF_SPACE_URL?.replace(/\/+$/, "") || "";
  const apiKey = process.env.HF_API_SECRET || "";

  if (!baseUrl) {
    throw new Error("HF_SPACE_URL environment variable is not configured.");
  }

  let delay = 2000;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return (await res.json()) as T;
      }

      // Retry on cold start or rate limiting (429, 502, 503, 504)
      if (![429, 502, 503, 504].includes(res.status) || i === tries - 1) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`HF error ${res.status}: ${errorText || res.statusText}`);
      }
    } catch (err: unknown) {
      if (i === tries - 1) {
        throw err;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 2.5;
  }

  throw new Error("unreachable");
}

/**
 * Returns raw stream response from Hugging Face Space for insights streaming
 */
export async function hfStream(path: string, body: unknown, tries = 3): Promise<Response> {
  const baseUrl = process.env.HF_SPACE_URL?.replace(/\/+$/, "") || "";
  const apiKey = process.env.HF_API_SECRET || "";

  if (!baseUrl) {
    throw new Error("HF_SPACE_URL environment variable is not configured.");
  }

  let delay = 2000;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return res;
      }

      if (![429, 502, 503, 504].includes(res.status) || i === tries - 1) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`HF stream error ${res.status}: ${errorText || res.statusText}`);
      }
    } catch (err: unknown) {
      if (i === tries - 1) {
        throw err;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 2.5;
  }

  throw new Error("unreachable");
}
