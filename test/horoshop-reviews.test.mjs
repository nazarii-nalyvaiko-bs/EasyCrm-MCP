import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getProductReviews,
  parseProductReviewPage,
  productReviewUrl,
} from "../dist/horoshop/reviews.js";

const storeOrigin = "https://shop.example.com";
const review = `
  <div itemprop="review" itemscope itemtype="https://schema.org/Review">
    <div itemprop="author" itemscope itemtype="https://schema.org/Person">
      <span itemprop="name">Alex</span>
    </div>
    <meta itemprop="datePublished" content="2026-08-01T10:00:00+03:00">
    <div itemprop="reviewBody">Comfortable<br>and light.</div>
  </div>
  <div itemprop="comment" itemscope itemtype="https://schema.org/Comment">
    <div itemprop="text">Thanks for the review</div>
  </div>
`;

function productPage(reviews, countMarkup, more = "") {
  return `<div itemscope itemtype="https://schema.org/Product">
    ${countMarkup}
    ${reviews}
    ${more}
  </div>`;
}

test("accepts only product paths on the configured store", () => {
  assert.equal(productReviewUrl(storeOrigin, "/shoes/123/#comments").href, `${storeOrigin}/shoes/123/`);
  assert.equal(productReviewUrl(storeOrigin, `${storeOrigin}/shoes/123/`).href, `${storeOrigin}/shoes/123/`);
  for (const input of ["https://other.example.com/item/", "//other.example.com/item/", "http://shop.example.com/item/"]) {
    assert.throws(() => productReviewUrl(storeOrigin, input), /configured Horoshop store/);
  }
});

test("reads review microdata, ignores replies, and accepts missing ratings", () => {
  const html = productPage(review, '<meta itemprop="reviewCount" content="1">');
  assert.deepEqual(parseProductReviewPage(html), {
    reviews: [{
      author: "Alex",
      publishedAt: "2026-08-01T10:00:00+03:00",
      rating: null,
      text: "Comfortable and light.",
    }],
    totalCount: 1,
    hasMore: false,
  });
});

test("uses the displayed Horoshop count when aggregate rating is absent", () => {
  const html = productPage(
    review,
    '<span class="product-comments-count j-comments-count">7</span>',
    '<span data-href="/_widget/ajax_comments/render/?offset=1&token=dynamic">More</span>',
  );
  assert.equal(parseProductReviewPage(html)?.totalCount, 7);
  assert.equal(parseProductReviewPage(html)?.hasMore, true);
  assert.equal(parseProductReviewPage("<html>Verification required</html>"), null);
});

test("returns a bounded, explicitly incomplete HTTP result without starting a browser", async (t) => {
  const html = productPage(
    review + review,
    '<meta itemprop="reviewCount" content="4">',
    '<span data-href="/_widget/ajax_comments/render/?offset=2&token=dynamic">More</span>',
  );
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(String(url));
    return new Response(html, { headers: { "content-type": "text/html" } });
  });

  const result = await getProductReviews(storeOrigin, "/shoes/123/", 1);
  assert.equal(result.reviews.length, 1);
  assert.equal(result.totalCount, 4);
  assert.equal(result.complete, false);
  assert.deepEqual(requests, [`${storeOrigin}/shoes/123/`]);
});
