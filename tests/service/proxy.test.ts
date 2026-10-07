import { describe, expect, test } from "bun:test";
import {
  isAllowedUpstreamRequest,
  MemoryProxy,
  ProxyRequestError,
  stripProfileVectors,
} from "../../service/proxy";

describe("isAllowedUpstreamRequest", () => {
  test("allows only required methods for supported endpoints", () => {
    expect(isAllowedUpstreamRequest("GET", "/api/stats")).toBe(true);
    expect(isAllowedUpstreamRequest("GET", "/api/tags")).toBe(true);
    expect(isAllowedUpstreamRequest("GET", "/api/memories")).toBe(true);
    expect(isAllowedUpstreamRequest("GET", "/api/search")).toBe(true);
    expect(isAllowedUpstreamRequest("GET", "/api/user-profile")).toBe(true);
    expect(isAllowedUpstreamRequest("POST", "/api/memories")).toBe(true);
    expect(isAllowedUpstreamRequest("POST", "/api/memories/bulk-delete")).toBe(true);
    expect(isAllowedUpstreamRequest("POST", "/api/memories/merge")).toBe(true);
    expect(isAllowedUpstreamRequest("POST", "/api/memories/abc/pin")).toBe(true);
    expect(isAllowedUpstreamRequest("POST", "/api/memories/abc/unpin")).toBe(true);
    expect(isAllowedUpstreamRequest("POST", "/api/cleanup")).toBe(true);
    expect(isAllowedUpstreamRequest("POST", "/api/deduplicate")).toBe(true);
    expect(isAllowedUpstreamRequest("POST", "/api/user-profile/refresh")).toBe(true);
    expect(isAllowedUpstreamRequest("PUT", "/api/memories/abc")).toBe(true);
    expect(isAllowedUpstreamRequest("DELETE", "/api/memories/abc")).toBe(true);
    expect(isAllowedUpstreamRequest("PATCH", "/api/user-profile/item")).toBe(true);
    expect(isAllowedUpstreamRequest("POST", "/api/migration/run")).toBe(false);
    expect(isAllowedUpstreamRequest("PUT", "/api/memories")).toBe(false);
  });

  test("rejects alternate origins and traversal attempts", () => {
    expect(isAllowedUpstreamRequest("GET", "https://example.test/api/stats")).toBe(false);
    expect(isAllowedUpstreamRequest("GET", "//example.test/api/stats")).toBe(false);
    expect(isAllowedUpstreamRequest("GET", "/../api/stats")).toBe(false);
    expect(isAllowedUpstreamRequest("GET", "/api/%2e%2e/stats")).toBe(false);
    expect(isAllowedUpstreamRequest("GET", "/api/memories%2f..%2fstats")).toBe(false);
  });
});

test("forwards an allowlisted request with the dedicated upstream token", async () => {
  const requests: Request[] = [];
  const proxy = new MemoryProxy({
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return new Response('{"success":true}', {
        status: 201,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": "must-not-forward",
        },
      });
    },
    readToken: () => "upstream-test-token",
  });

  const response = await proxy.request({
    method: "GET",
    pathname: "/api/memories",
    query: new URLSearchParams({ page: "1", pageSize: "2" }),
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(
    "http://127.0.0.1:4747/api/memories?page=1&pageSize=2",
  );
  expect(requests[0]?.headers.get("x-opencode-mem-token")).toBe(
    "upstream-test-token",
  );
  expect(requests[0]?.headers.get("authorization")).toBeNull();
  expect(response).toEqual({
    status: 201,
    body: '{"success":true}',
    contentType: "application/json",
  });
});

test("rejects malformed mutation bodies before calling upstream", async () => {
  const proxy = new MemoryProxy({
    fetch: async () => new Response(),
    readToken: () => "upstream-test-token",
  });

  await expect(
    proxy.request({
      method: "POST",
      pathname: "/api/memories",
      body: "not-json",
    }),
  ).rejects.toEqual(
    new ProxyRequestError("INVALID_REQUEST", "Request body must be valid JSON"),
  );
});

test("reports a missing host token separately from an unreachable upstream", async () => {
  let fetchCalled = false;
  const proxy = new MemoryProxy({
    fetch: async () => {
      fetchCalled = true;
      return new Response();
    },
    readToken: () => {
      throw new ProxyRequestError("AUTH_TOKEN_UNAVAILABLE", "opencode-mem authentication token is unavailable");
    },
  });

  await expect(proxy.request({ method: "GET", pathname: "/api/stats" })).rejects.toEqual(
    new ProxyRequestError("AUTH_TOKEN_UNAVAILABLE", "opencode-mem authentication token is unavailable"),
  );
  expect(fetchCalled).toBe(false);
});

test("maps an upstream timeout to a stable error", async () => {
  const proxy = new MemoryProxy({
    fetch: async () => {
      throw new DOMException("Timed out", "TimeoutError");
    },
    readToken: () => "upstream-test-token",
  });

  await expect(
    proxy.request({ method: "GET", pathname: "/api/stats" }),
  ).rejects.toEqual(
    new ProxyRequestError(
      "UPSTREAM_TIMEOUT",
      "opencode-mem did not respond in time",
    ),
  );
});

test("preserves upstream error statuses and JSON bodies", async () => {
  for (const status of [401, 404, 500]) {
    const proxy = new MemoryProxy({
      fetch: async () =>
        new Response('{"success":false}', {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      readToken: () => "upstream-test-token",
    });

    await expect(proxy.request({ method: "GET", pathname: "/api/stats" })).resolves.toEqual({
      status,
      body: '{"success":false}',
      contentType: "application/json",
    });
  }
});

test("maps an unavailable upstream to a stable error", async () => {
  const proxy = new MemoryProxy({
    fetch: async () => {
      throw new Error("connection refused");
    },
    readToken: () => "upstream-test-token",
  });

  await expect(
    proxy.request({ method: "GET", pathname: "/api/stats" }),
  ).rejects.toEqual(
    new ProxyRequestError(
      "UPSTREAM_UNAVAILABLE",
      "opencode-mem is not reachable on 127.0.0.1:4747",
    ),
  );
});

test("strips embedding vectors from profile responses before the host sees them", async () => {
  const profileBody = JSON.stringify({
    success: true,
    data: {
      exists: true,
      version: 3,
      profileData: {
        preferences: [{ category: "editor", description: "Prefers vim", confidence: 0.9, centroid: [1, 2, 3], anchor: [4, 5] }],
        patterns: [{ category: "testing", description: "Runs bun test", steps: undefined, centroid: [6] }],
        workflows: [{ category: "review", description: "Reviews PRs", steps: ["read", "test"], anchor: [7] }],
      },
    },
  });
  const proxy = new MemoryProxy({
    fetch: async () =>
      new Response(profileBody, { headers: { "Content-Type": "application/json" } }),
    readToken: () => "upstream-test-token",
  });

  const response = await proxy.request({ method: "GET", pathname: "/api/user-profile" });

  const parsed = JSON.parse(response.body) as {
    success: boolean;
    data: { version: number; profileData: Record<string, Array<Record<string, unknown>>> };
  };
  expect(parsed.success).toBe(true);
  expect(parsed.data.version).toBe(3);
  for (const section of ["preferences", "patterns", "workflows"]) {
    for (const item of parsed.data.profileData[section] ?? []) {
      expect("centroid" in item).toBe(false);
      expect("anchor" in item).toBe(false);
    }
  }
  expect(parsed.data.profileData.patterns[0]?.description).toBe("Runs bun test");
  expect(parsed.data.profileData.workflows[0]?.steps).toEqual(["read", "test"]);
});

test("stripProfileVectors leaves other routes, error envelopes, and bad JSON untouched", () => {
  const vectors = '{"success":true,"data":{"profileData":{"preferences":[{"centroid":[1]}]}}}';
  expect(stripProfileVectors("/api/memories", vectors)).toBe(vectors);
  expect(stripProfileVectors("/api/user-profile", '{"success":false,"error":"Unauthorized"}')).toBe(
    '{"success":false,"error":"Unauthorized"}',
  );
  expect(stripProfileVectors("/api/user-profile", "not-json")).toBe("not-json");
  const noVectors = '{"success":true,"data":{"profileData":{"preferences":[{"confidence":1}]}}}';
  expect(stripProfileVectors("/api/user-profile", noVectors)).toBe(noVectors);
  expect(stripProfileVectors("/api/user-profile/refresh", vectors)).toBe(
    '{"success":true,"data":{"profileData":{"preferences":[{}]}}}',
  );
});

test("does not mark JSON-like upstream media types as JSON", async () => {
  const proxy = new MemoryProxy({
    fetch: async () =>
      new Response("callback({})", {
        headers: { "Content-Type": "application/jsonp" },
      }),
    readToken: () => "upstream-test-token",
  });

  await expect(proxy.request({ method: "GET", pathname: "/api/stats" })).resolves.toEqual({
    status: 200,
    body: "callback({})",
    contentType: undefined,
  });
});
