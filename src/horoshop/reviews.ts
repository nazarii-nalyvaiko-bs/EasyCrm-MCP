import { load } from "cheerio";

export interface ProductReview {
  author: string | null;
  publishedAt: string | null;
  rating: number | null;
  text: string;
}

export interface ProductReviews {
  productUrl: string;
  reviews: ProductReview[];
  totalCount: number | null;
  complete: boolean;
  incompleteReason?: string;
}

interface ReviewPage {
  reviews: ProductReview[];
  totalCount: number | null;
  hasMore: boolean;
}

const MORE_REVIEWS = '[data-href*="/_widget/ajax_comments/render/"], a[href*="/_widget/ajax_comments/render/"]';
const MAX_BROWSER_LOADS = 20;

class ProductPageHttpError extends Error {
  constructor(readonly status: number) {
    super(`Horoshop product page returned HTTP ${status}`);
    this.name = "ProductPageHttpError";
  }
}

export function productReviewUrl(storeOrigin: string, input: string): URL {
  let url: URL;
  try {
    url = new URL(input, `${storeOrigin}/`);
  } catch {
    throw new Error("productUrl must be a URL or path on the configured Horoshop store");
  }
  if (url.origin !== storeOrigin || url.protocol !== "https:" || url.username || url.password) {
    throw new Error("productUrl must be on the configured Horoshop store");
  }
  url.hash = "";
  return url;
}

export function parseProductReviewPage(html: string): ReviewPage | null {
  const $ = load(html);
  const product = $("[itemscope][itemtype]").filter((_, element) =>
    $(element).attr("itemtype")?.split(/\s+/).some((type) => type.endsWith("/Product")) === true,
  ).first();
  if (product.length === 0) return null;

  const countText = (
    product.find('[itemprop="reviewCount"]').first().attr("content")
    || product.find(".j-comments-count").first().text()
  ).trim();
  const count = Number(countText);
  const totalCount = /^\d+$/.test(countText) && Number.isSafeInteger(count) ? count : null;

  const reviews = product.find('[itemprop="review"][itemscope]').filter((_, element) =>
    $(element).attr("itemtype")?.split(/\s+/).some((type) => type.endsWith("/Review")) === true,
  ).toArray().flatMap((element): ProductReview[] => {
    const review = $(element);
    const body = review.find('[itemprop="reviewBody"]').first();
    body.find("br").replaceWith(" ");
    body.find("p, li").append(" ");
    const text = body.text().replace(/\s+/g, " ").trim();
    if (!text) return [];

    const author = review.find('[itemprop="author"] [itemprop="name"]').first().text().trim() || null;
    const publishedAt = review.find('[itemprop="datePublished"]').first().attr("content") || null;
    const ratingText = review.find('[itemprop="ratingValue"]').first().attr("content");
    const rating = ratingText?.trim() ? Number(ratingText) : null;

    return [{
      author,
      publishedAt,
      rating: rating !== null && Number.isFinite(rating) ? rating : null,
      text,
    }];
  });

  return { reviews, totalCount, hasMore: product.find(MORE_REVIEWS).length > 0 };
}

function toResult(url: URL, page: ReviewPage, maxReviews: number): ProductReviews {
  return {
    productUrl: url.href,
    reviews: page.reviews.slice(0, maxReviews),
    totalCount: page.totalCount,
    complete: page.totalCount !== null && page.reviews.length >= page.totalCount
      && page.totalCount <= maxReviews,
  };
}

async function fetchProductPage(url: URL): Promise<string> {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(current, {
      headers: { Accept: "text/html" },
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Horoshop product page redirected without a location");
      current = productReviewUrl(url.origin, new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new ProductPageHttpError(response.status);
    return response.text();
  }
  throw new Error("Horoshop product page redirected too many times");
}

async function readInBrowser(url: URL, maxReviews: number): Promise<ProductReviews> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    ...(process.env.HOROSHOP_BROWSER_EXECUTABLE_PATH
      ? { executablePath: process.env.HOROSHOP_BROWSER_EXECUTABLE_PATH }
      : {}),
  }).catch((error: unknown) => {
    throw new Error("Chrome could not start; install Google Chrome or set HOROSHOP_BROWSER_EXECUTABLE_PATH", {
      cause: error,
    });
  });
  try {
    const probe = await browser.newPage();
    const browserAgent = await probe.evaluate(() => navigator.userAgent);
    await probe.close();
    // Horoshop's comment request can reject Chrome's HeadlessChrome user agent.
    const context = await browser.newContext({
      userAgent: browserAgent.replace("HeadlessChrome/", "Chrome/"),
    });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && new URL(request.url()).origin !== url.origin) {
        return route.abort();
      }
      const type = request.resourceType();
      return type === "image" || type === "font" || type === "media"
        ? route.abort()
        : route.continue();
    });
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.locator('[itemscope][itemtype$="/Product"]').first().waitFor({ timeout: 15_000 });
    if (new URL(page.url()).origin !== url.origin) {
      throw new Error("Horoshop product page redirected outside the configured store");
    }

    let parsed = parseProductReviewPage(await page.content());
    if (!parsed) throw new Error("Horoshop product markup was not found");

    let stalled = false;
    for (let loaded = 0; loaded < MAX_BROWSER_LOADS; loaded += 1) {
      if (!parsed.hasMore || parsed.reviews.length >= maxReviews) break;
      if (parsed.totalCount !== null && parsed.reviews.length >= parsed.totalCount) break;

      const before = parsed.reviews.length;
      await page.locator(MORE_REVIEWS).first().dispatchEvent("click");
      try {
        await page.waitForFunction(
          (count) => {
            const product = document.querySelector('[itemscope][itemtype$="/Product"]');
            return product !== null
              && product.querySelectorAll('[itemprop="review"][itemscope]').length > count;
          },
          before,
          { timeout: 10_000 },
        );
      } catch {
        stalled = true;
        break;
      }
      parsed = parseProductReviewPage(await page.content());
      if (!parsed) throw new Error("Horoshop product markup disappeared after loading reviews");
    }
    const result = toResult(url, parsed, maxReviews);
    if (stalled && !result.complete) {
      result.incompleteReason = "The next review batch did not load";
    }
    return result;
  } finally {
    await browser.close();
  }
}

export async function getProductReviews(
  storeOrigin: string,
  productUrl: string,
  maxReviews: number,
): Promise<ProductReviews> {
  const url = productReviewUrl(storeOrigin, productUrl);
  let initial: ReviewPage | null = null;
  try {
    initial = parseProductReviewPage(await fetchProductPage(url));
  } catch (error) {
    if (!(error instanceof ProductPageHttpError) || (error.status !== 403 && error.status !== 429)) {
      throw error;
    }
  }

  if (initial) {
    const enough = initial.reviews.length >= maxReviews
      || (initial.totalCount !== null && initial.reviews.length >= initial.totalCount);
    if (enough || (initial.totalCount === null && !initial.hasMore)) {
      return toResult(url, initial, maxReviews);
    }
  }
  try {
    return await readInBrowser(url, maxReviews);
  } catch (error) {
    if (!initial || initial.reviews.length === 0) throw error;
    return {
      ...toResult(url, initial, maxReviews),
      incompleteReason: error instanceof Error ? error.message : String(error),
    };
  }
}
